import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabaseServer';
import { ImportHttpError, processHistoricalCSV } from '@/lib/importEngine';
import { requireAdmin } from '@/lib/authHelpers';

// create-upload-session: skapar import_job + signerad URL
// start-import: läser fil från Storage och importerar till DB
type CreateUploadSessionRequest = {
  action: 'create-upload-session';
  filename: string;
};

type StartImportRequest = {
  action: 'start-import';
  jobId: string;
};

type HistoricalImportRequest = CreateUploadSessionRequest | StartImportRequest;

// Hela importen körs i en enda request: nedladdning, parsning, batchvisa
// upserts (varje rad passerar fyra BEFORE-triggers) och deduplicering.
// Utan detta gäller plattformens standardgräns, som en månadsfil spränger.
export const maxDuration = 300;



async function handleCreateUploadSession(adminId: string, filename: string) {
  if (!filename) {
    throw new ImportHttpError(400, 'Filnamn saknas i request.');
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const jobId = crypto.randomUUID();
  const storagePath = `imports/${jobId}.csv`;

  const { error: insertError } = await supabaseAdmin
    .from('import_jobs')
    .insert({
      id: jobId,
      admin_id: adminId,
      status: 'uploading',
      storage_path: storagePath,
    });

  if (insertError) {
    throw new ImportHttpError(500, 'Kunde inte skapa import-jobb i databasen.');
  }

  const { data: signedUrlData, error: urlError } = await supabaseAdmin
    .storage
    .from('historical-imports')
    .createSignedUploadUrl(storagePath);

  if (urlError || !signedUrlData) {
    throw new ImportHttpError(500, 'Kunde inte generera uppladdnings-URL.');
  }

  return {
    jobId,
    uploadUrl: signedUrlData.signedUrl,
    storagePath,
  };
}

async function handleStartImport(adminId: string, jobId: string) {
  if (!jobId) {
    throw new ImportHttpError(400, 'jobId saknas i request.');
  }

  const supabaseAdmin = getSupabaseAdminClient();

  const { data: job, error: jobError } = await supabaseAdmin
    .from('import_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('admin_id', adminId)
    .single();

  if (jobError || !job) {
    throw new ImportHttpError(404, 'Import-jobb hittades inte.');
  }

  if (!job.storage_path) {
    throw new ImportHttpError(400, 'Lagringsväg saknas för import-jobbet.');
  }

  const storagePath = job.storage_path;

  try {
    await supabaseAdmin
      .from('import_jobs')
      .update({ status: 'validating' })
      .eq('id', jobId);

    const { data: fileBlob, error: downloadError } = await supabaseAdmin
      .storage
      .from('historical-imports')
      .download(storagePath);

    if (downloadError || !fileBlob) {
      throw new ImportHttpError(
        500,
        `Kunde inte ladda ned CSV-filen: ${downloadError?.message || 'Okänt fel'}`,
      );
    }

    const csvContent = await fileBlob.text();
    const result = await processHistoricalCSV(csvContent, adminId, storagePath);

    await supabaseAdmin
      .from('import_jobs')
      .update({ status: 'deduplicating' })
      .eq('id', jobId);
    const { data: dedupedRows, error: dedupeError } = await supabaseAdmin.rpc(
      'dedupe_historical_shipment_after_import',
      { in_source_file_name: storagePath },
    );
    if (dedupeError) {
      // Raderna är redan skrivna och committade vid det här laget – varje batch
      // är en egen transaktion. Meddelandet måste därför säga att datan finns
      // kvar, annars läser admin det som att hela importen gick förlorad.
      throw new ImportHttpError(
        500,
        `Raderna importerades, men dedupliceringen misslyckades: ${dedupeError.message}. `
        + 'Datan finns i databasen men äldre priser för samma kund, viktklass och '
        + 'relation ligger kvar. Kör dedupliceringen igen.',
      );
    }

    await supabaseAdmin
      .from('import_jobs')
      .update({
        status: 'completed',
        rows_total: result.rowsFound,
        rows_processed: result.rowsFound,
        rows_valid: result.rowsFound - result.filteredOutRows - result.nonPositiveRows,
        rows_failed:
          result.rowsFound
          - result.insertedRows
          - result.filteredOutRows
          - result.nonPositiveRows,
        inserted_row_count: result.insertedRows,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    return {
      jobId,
      status: 'completed',
      result: {
        ...result,
        replacedRows: typeof dedupedRows === 'number' ? dedupedRows : 0,
      },
    };
  } catch (error) {
    const errorMessage =
      error instanceof ImportHttpError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Okänt fel vid import';

    const validationErrors =
      error instanceof ImportHttpError && error.data?.errors ? error.data.errors : [];

    await supabaseAdmin
      .from('import_jobs')
      .update({
        status: 'error',
        error_message: errorMessage,
        validation_errors: validationErrors,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    throw error;
  } finally {
    // Filen tas alltid bort efter importförsök (både success/failure).
    await supabaseAdmin.storage.from('historical-imports').remove([storagePath]);
  }
}

export async function POST(request: Request) {
  try {
    const { error } = await requireAdmin()
    if (error) return error;

    const { data: { user } } = await (await import('@/lib/supabaseServer')).getSupabaseServerClient()
      .then(c => c.auth.getUser());

    const body = (await request.json()) as HistoricalImportRequest;

    if (body.action === 'create-upload-session') {
      const session = await handleCreateUploadSession(user!.id, body.filename);
      return NextResponse.json(session);
    }

    if (body.action === 'start-import') {
      const result = await handleStartImport(user!.id, body.jobId);
      return NextResponse.json(result);
    }

    return NextResponse.json(
      { error: 'Ogiltig action. Förväntade create-upload-session eller start-import.' },
      { status: 400 },
    );
  } catch (error) {
    const statusCode = error instanceof ImportHttpError ? error.statusCode : 500;
    const message =
      error instanceof ImportHttpError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Internt serverfel.';

    return NextResponse.json({ error: message }, { status: statusCode });
  }
}