import { getSupabaseAdminClient } from '@/lib/supabaseServer';
import type { Database } from '@/lib/supabaseServerSchema';

// Typ för en rad som ska kunna sparas i Historical_shipment.
export type HistoricalInsert = Database['public']['Tables']['Historical_shipment']['Insert'];
export type PaketburPriceUpsert = Database['public']['Tables']['paketbur_prices']['Insert'];

// Resultatet av CSV-parsning: en header-rad + alla data-rader.
type ParsedCSV = {
    header: string[];
    rows: string[][];
};

// Kolumner som MÅSTE finnas i CSV för att importen ska godkännas för trappsteg.
const REQUIRED_HEADERS = [
    'avbgsp_id',
    'Fraktsedelsnr',
    'Kundnr',
    'Kundnamn',
    'Linjenr',
    'Avsändandeort',
    'Avs postnr',
    'Bestammelseort',
    'Bes postnr',
    'Lf-datum',
    'Avräkningsdatum',
    'Ers exk tillägg',
    'Ers ink tillägg',
    'Kundnettofrakt',
    'DMT',
    'Enhet',
    'Fraktgrundandevikt',
] as const;

export function getMissingHeaders(headers: string[]): string[] {
    return REQUIRED_HEADERS.filter((required) => !headers.includes(required));
}

export type ImportProgress = {
    phase: 'validating' | 'inserting';
    processedRows: number;
    totalRows: number;
    percentage: number;
    message: string;
};

export type ImportResult = {
    columnsFound: number;
    rowsFound: number;
    insertedRows: number;
    filteredOutRows: number;
    nonPositiveRows: number;
    paketburRowsUpdated?: number;
};

type WeightClassInterval = {
    min: number;
    max: number;
    vkl: number;
};

async function loadWeightClassIntervals(
    supabaseAdmin: ReturnType<typeof getSupabaseAdminClient>,
): Promise<WeightClassInterval[]> {
    const { data, error } = await supabaseAdmin.rpc('get_entire_vkl_table');

    if (error) {
        throw new ImportHttpError(
            500,
            `Kunde inte hämta viktklasstabell: ${error.message}`,
        );
    }

    if (!Array.isArray(data) || data.length === 0) {
        throw new ImportHttpError(500, 'Kunde inte hämta giltig viktklasstabell.');
    }

    return data;
}

function resolveWeightClass(
    weight: number,
    intervals: WeightClassInterval[],
): number | null {
    const interval = intervals.find((row) => weight >= row.min && weight <= row.max);
    return interval?.vkl ?? null;
}

export class ImportHttpError extends Error {
    // statusCode används av route-lagret för att skicka rätt HTTP-status till klienten.
    constructor(
        public readonly statusCode: number,
        message: string,
        public readonly data?: { errorCount?: number; errors?: string[] }
    ) {
        super(message);
        this.name = 'ImportHttpError';
    }
}

/**
 * Detects whether the line uses semicolon or comma as delimiter.
 * Comma-delimited lines have quoted fields containing commas.
 */
function detectDelimiter(line: string): ';' | ',' {
    let semiCount = 0;
    let commaCount = 0;
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (!inQuotes) {
            if (char === ';') semiCount++;
            if (char === ',') commaCount++;
        }
    }

    // If more unquoted commas than semicolons, use comma as delimiter
    return commaCount > semiCount ? ',' : ';';
}

/**
 * Parses a CSV line with the specified delimiter.
 * Handles quoted strings so that delimiters inside quotes don't split fields.
 */
function parseCSVLine(line: string, delimiter: ';' | ',' = ';'): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            const next = line[i + 1];
            if (inQuotes && next === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === delimiter && !inQuotes) {
            fields.push(current.trim());
            current = '';
            continue;
        }

        current += char;
    }

    fields.push(current.trim());
    return fields;
}

/**
 * Konverterar text -> number.
 * Klarar svenska decimaler (","), negativa tal (med − eller -), och ignorerar tomma/NULL-värden.
 */
export function normalizeNumber(value: string | undefined): number | null {
    if (!value) {
        return null;
    }

    const trimmed = value.trim();
    if (trimmed === '' || trimmed.toLowerCase() === 'null') {
        return null;
    }

    // Normalize different types of minus signs to regular ASCII minus
    const normalized = trimmed
        .replace(/\s/g, '')           // Remove whitespace
        .replace(/−/g, '-')            // Unicode minus sign → ASCII minus
        .replace(/–/g, '-')            // En-dash → ASCII minus
        .replace(/—/g, '-')            // Em-dash → ASCII minus
        .replace(',', '.')            // Swedish comma decimal → period
        .replace(/×10\^([+-]?\d+)/i, 'e$1');   // 7.07138×10^+16 → 7.07138e+16

    const parsed = Number(normalized);

    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Samma som normalizeNumber men returnerar heltal.
 */
export function normalizeInteger(value: string | undefined): number | null {
    const n = normalizeNumber(value);
    if (n === null) return null;
    return Number.isInteger(n) ? n : Math.round(n);
}

/**
 * Validerar och normaliserar datum i format YYYY-MM-DD eller MM/DD/YYYY.
 * Accepterar MM/DD/YYYY även utan ledande nollor (t.ex. 1/5/2023).
 * Returnerar datum i YYYY-MM-DD format, eller null om tomt/ogiltigt.
 */
export function normalizeDate(value: string | undefined): string | null {
    if (!value) {
        return null;
    }

    const trimmed = value.trim();
    if (trimmed === '' || trimmed.toLowerCase() === 'null') {
        return null;
    }

    // Try YYYY-MM-DD format first
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        const timestamp = Date.parse(trimmed);
        if (!Number.isNaN(timestamp)) {
            return trimmed;
        }
    }

    // Try MM/DD/YYYY format (with or without leading zeros)
    const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
        const month = parseInt(slashMatch[1], 10);
        const day = parseInt(slashMatch[2], 10);
        const year = parseInt(slashMatch[3], 10);

        // Validate ranges
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            // Construct YYYY-MM-DD format with leading zeros
            const normalizedDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            
            // Verify the date is actually valid
            const timestamp = Date.parse(normalizedDate);
            if (!Number.isNaN(timestamp)) {
                return normalizedDate;
            }
        }
    }

    return null;
}

/**
 * Parser hela CSV-innehållet till header + rader.
 * Hanterar BOM, citattecken, och filtrerar tomma rader.
 * Automatisk detekterar om ; eller , används som delimiter.
 */
export function parseCSV(content: string): ParsedCSV {
    const cleaned = content.replace(/\uFEFF/, '');
    const lines = cleaned.split(/\r?\n/).filter(line => line.trim() !== '');

    const headerIndex = lines.findIndex((line) => 
        line.includes('Fraktsedelsnr;') || line.includes('Fraktsedelsnr,')
    );
    if (headerIndex === -1) {
        throw new ImportHttpError(400, 'Kunde inte hitta rubrikraden i CSV-filen.');
    }

    // Detect delimiter from the header line
    const delimiter = detectDelimiter(lines[headerIndex]);
    
    const header = parseCSVLine(lines[headerIndex], delimiter);
    const rows: string[][] = [];

    for (let i = headerIndex + 1; i < lines.length; i++) {
        const parsed = parseCSVLine(lines[i], delimiter);
        const hasData = parsed.some((cell) => cell !== '' && cell.toLowerCase() !== 'null');
        if (!hasData) {
            continue;
        }

        while (parsed.length < header.length) {
            parsed.push('');
        }

        rows.push(parsed);
    }

    return { header, rows };
}

function roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Processerar CSV-innehål: parsing, validering, och insert.
 * Returnerar antal rader som lästs in.
 */
export async function processHistoricalCSV(
    csvContent: string,
    adminId: string,
    sourceFileName: string,
    onProgress?: (progress: ImportProgress) => void
): Promise<ImportResult> {
    const parsed = parseCSV(csvContent);

    const missingHeaders = getMissingHeaders(parsed.header);
    if (missingHeaders.length > 0) {
        throw new ImportHttpError(
            400,
            `CSV saknar obligatoriska kolumner: ${missingHeaders.join(', ')}`,
        );
    }

    const headerIndexMap = new Map<string, number>();
    parsed.header.forEach((columnName, idx) => headerIndexMap.set(columnName, idx));

    const getCell = (row: string[], headerName: string): string => {
        const idx = headerIndexMap.get(headerName);
        if (idx === undefined) {
            return '';
        }
        return (row[idx] ?? '').trim();
    };

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new ImportHttpError(
            500,
            'Import misslyckades: SUPABASE_SERVICE_ROLE_KEY saknas i servermiljön.',
        );
    }

    const supabaseAdmin = getSupabaseAdminClient();
    
    const [weightClassIntervals, taxPointsResult] = await Promise.all([
        loadWeightClassIntervals(supabaseAdmin),
        supabaseAdmin.from('tax_point_lookup').select('postnummer, kontorsforkortning')
    ]);

    const taxPointMap = new Map<number, string>();
    taxPointsResult.data?.forEach((tp) => {
        if (tp.postnummer && tp.kontorsforkortning) {
            taxPointMap.set(tp.postnummer, tp.kontorsforkortning.trim().toUpperCase());
        }
    });

    const rowsToInsert: HistoricalInsert[] = [];
    const paketburRowsToUpsert: PaketburPriceUpsert[] = [];
    const rowErrors: string[] = [];
    const importedAt = new Date().toISOString();
    const totalRows = parsed.rows.length;
    let filteredOutRows = 0;
    let nonPositiveRows = 0;

    // Valideringspass
    for (let i = 0; i < parsed.rows.length; i++) {
        const row = parsed.rows[i];
        const rowNumber = i + 2;

        const shipmentIdRaw = getCell(row, 'Fraktsedelsnr');
        if (!shipmentIdRaw) {
            continue;
        }

        const avbgspId = normalizeInteger(getCell(row, 'avbgsp_id'));
        const shipmentId = normalizeInteger(getCell(row, 'Fraktsedelsnr'));
        const customerId = normalizeInteger(getCell(row, 'Kundnr'));
        const customerNameRaw = getCell(row, 'Kundnamn');
        const customerName = customerNameRaw || null;
        const lineNumber = normalizeInteger(getCell(row, 'Linjenr'));
        const senderCity = getCell(row, 'Avsändandeort');
        const senderZip = normalizeInteger(getCell(row, 'Avs postnr'));
        const receiverCity = getCell(row, 'Bestammelseort');
        const receiverZip = normalizeInteger(getCell(row, 'Bes postnr'));
        const dateCompleted = normalizeDate(getCell(row, 'Lf-datum'));
        const uploadDate = normalizeDate(getCell(row, 'Avräkningsdatum'));
        const compExclAddon = normalizeNumber(getCell(row, 'Ers exk tillägg'));
        const compInclAddon = normalizeNumber(getCell(row, 'Ers ink tillägg'));
        const netCustomerFreight = normalizeNumber(getCell(row, 'Kundnettofrakt'));
        const dmt = normalizeNumber(getCell(row, 'DMT')) ?? 0;
        const regNumber = getCell(row, 'Enhet');
        const weight = normalizeInteger(getCell(row, 'Fraktgrundandevikt'));

        if (avbgspId === null) rowErrors.push(`Rad ${rowNumber}: avbgsp_id är ogiltig.`);
        if (shipmentId === null) rowErrors.push(`Rad ${rowNumber}: Fraktsedelsnr är ogiltig.`);
        if (customerId === null) rowErrors.push(`Rad ${rowNumber}: Kundnr är ogiltig.`);
        if (lineNumber === null) rowErrors.push(`Rad ${rowNumber}: Linjenr är ogiltig.`);
        if (!senderCity) rowErrors.push(`Rad ${rowNumber}: Avsändandeort saknas.`);
        if (senderZip === null) rowErrors.push(`Rad ${rowNumber}: Avs postnr är ogiltigt.`);
        if (!receiverCity) rowErrors.push(`Rad ${rowNumber}: Bestammelseort saknas.`);
        if (receiverZip === null) rowErrors.push(`Rad ${rowNumber}: Bes postnr är ogiltigt.`);
        if (dateCompleted === null) rowErrors.push(`Rad ${rowNumber}: Lf-datum är ogiltigt.`);
        if (uploadDate === null) rowErrors.push(`Rad ${rowNumber}: Avräkningsdatum är ogiltigt.`);
        if (compExclAddon === null) rowErrors.push(`Rad ${rowNumber}: Ers exk tillägg är ogiltig.`);
        if (compInclAddon === null) rowErrors.push(`Rad ${rowNumber}: Ers ink tillägg är ogiltig.`);
        if (netCustomerFreight === null) rowErrors.push(`Rad ${rowNumber}: Kundnettofrakt är ogiltig.`);
        if (!regNumber) rowErrors.push(`Rad ${rowNumber}: Enhet saknas.`);
        if (weight === null) rowErrors.push(`Rad ${rowNumber}: Fraktgrundandevikt är ogiltig.`);

        if (
            avbgspId !== null &&
            shipmentId !== null &&
            customerId !== null &&
            lineNumber !== null &&
            senderCity &&
            senderZip !== null &&
            receiverCity &&
            receiverZip !== null &&
            dateCompleted !== null &&
            uploadDate !== null &&
            compExclAddon !== null &&
            compInclAddon !== null &&
            netCustomerFreight !== null &&
            regNumber &&
            weight !== null
        ) {
            // Makuleringar och nollade rader. Historiken används för att räkna
            // fram ett kilopris (kundnetto / vikt), och varken en negativ eller
            // en nollad rad kan ge ett sådant. En rad med vikt 0 skulle dessutom
            // ge division med noll i steg 1 och slå ut hela kombinationen.
            // Filtret ligger före viktklassuppslaget, så att negativa vikter
            // aldrig behöver finnas i vikt_till_viktklass.
            if (weight <= 0 || netCustomerFreight <= 0) {
                nonPositiveRows += 1;
                continue;
            }

            const weightClass = resolveWeightClass(weight, weightClassIntervals);
            if (weightClass === null) {
                rowErrors.push(`Rad ${rowNumber}: Kunde inte avgöra viktklass för vikt ${weight}.`);
                continue;
            }

            // Paketburar (Kundnr: 98610009)
            if (customerId === 98610009) {
                const kolliRaw = getCell(row, 'Kolli');
                const kolli = kolliRaw ? normalizeInteger(kolliRaw) : 1;

                // Försök läsa 'Linjerel' direkt, annars bygg den via postnummerkartan
                let relation = getCell(row, 'Linjerel').trim().toUpperCase();
                if (!relation) {
                    const fromAbbr = taxPointMap.get(senderZip);
                    const toAbbr = taxPointMap.get(receiverZip);
                    if (fromAbbr && toAbbr) {
                        relation = `${fromAbbr}-${toAbbr}`;
                    }
                }

                if (relation && kolli && kolli > 0 && compExclAddon > 0) {
                    const aPris = roundMoney(compExclAddon / kolli);
                    paketburRowsToUpsert.push({
                        relation: relation,
                        antal_burar: kolli,
                        pris: aPris,
                        datum: dateCompleted
                    });
                }
            }

            if (weightClass <= 20) {
                filteredOutRows += 1;
                continue;
            }

            rowsToInsert.push({
                avbgsp_id: avbgspId,
                shipment_id: shipmentId,
                customer_id: customerId,
                customer_name: customerName,
                weight,
                line_number: lineNumber,
                sender_zip: senderZip,
                receiver_zip: receiverZip,
                sender_city: senderCity,
                receiver_city: receiverCity,
                reg_number: regNumber,
                date_completed: dateCompleted,
                upload_date: uploadDate,
                comp_excl_addon: compExclAddon,
                comp_incl_addon: compInclAddon,
                net_customer_freight: netCustomerFreight,
                DMT: dmt,
                admin_ID: adminId,
                imported_at: importedAt,
                source_file_name: sourceFileName,
            });
        }

        if (onProgress && totalRows > 0 && ((i + 1) % 250 === 0 || i === totalRows - 1)) {
            onProgress({
                phase: 'validating',
                processedRows: i + 1,
                totalRows,
                percentage: Math.round(((i + 1) / totalRows) * 100),
                message: 'Validerar rader...',
            });
        }
    }

    if (rowErrors.length > 0) {
        throw new ImportHttpError(
            400,
            `Validering misslyckades. Första fel: ${rowErrors[0]}`,
            {
                errorCount: rowErrors.length,
                errors: rowErrors,
            },
        );
    }

    // avbgsp_id är primärnyckeln: om samma avbgsp_id kommer in igen ska den gamla raden ersättas.
    const latestRowsByAvbgspId = new Map<number, HistoricalInsert>();
    for (const row of rowsToInsert) {
        if (row.avbgsp_id !== undefined && row.avbgsp_id !== null) {
            latestRowsByAvbgspId.set(row.avbgsp_id, row);
        }
    }

    const rowsToWrite = Array.from(latestRowsByAvbgspId.values());

    // Historical_shipment
    const batchSize = 500;
    const totalInsertRows = rowsToWrite.length;
    let insertedRows = 0;

    for (let start = 0; start < totalInsertRows; start += batchSize) {
        const batch = rowsToWrite.slice(start, start + batchSize);
        const { error: insertError } = await supabaseAdmin
            .from('Historical_shipment')
            .upsert(batch, { onConflict: 'avbgsp_id' });

        if (insertError) {
            throw new ImportHttpError(
                500,
                `Import misslyckades vid databasskrivning (Historical): ${insertError.message}`,
            );
        }

        insertedRows += batch.length;
        if (onProgress && totalInsertRows > 0) {
            onProgress({
                phase: 'inserting',
                processedRows: insertedRows,
                totalRows: totalInsertRows,
                percentage: Math.round((insertedRows / totalInsertRows) * 100),
                message: 'Sparar rader i databasen...',
            });
        }
    }

    // paketbur_prices
    if (paketburRowsToUpsert.length > 0) {
        // Sortera ut sista raden per unik kombination av relation+antal_burar i filen
        const latestPaketburMap = new Map<string, PaketburPriceUpsert>();
        for (const pRow of paketburRowsToUpsert) {
            const key = `${pRow.relation}_${pRow.antal_burar}`;
            latestPaketburMap.set(key, pRow);
        }
        const paketburToWrite = Array.from(latestPaketburMap.values());

        const { error: paketburError } = await supabaseAdmin
            .from('paketbur_prices')
            .upsert(paketburToWrite, { onConflict: 'relation,antal_burar' });

        if (paketburError) {
            throw new ImportHttpError(
                500,
                `Import misslyckades vid uppdatering av paketbur_prices: ${paketburError.message}`,
            );
        }
    }

    return {
        columnsFound: parsed.header.length,
        rowsFound: parsed.rows.length,
        insertedRows,
        filteredOutRows,
        nonPositiveRows,
        paketburRowsUpdated: paketburRowsToUpsert.length
    };
}
