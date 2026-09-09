import { useRef, useState, type ChangeEvent } from 'react';
import {
  createHistoricalImportSession,
  uploadHistoricalCsvToStorage,
  runHistoricalImport,
} from '@/lib/api';

type FileInputChangeEvent = ChangeEvent<HTMLInputElement>;

// Hook som kapslar hela UI-flödet för historisk CSV-import.
// Målet är att hålla page.tsx ren och samla all import-state på ett ställe.
export function useHistoricalImport() {
  const [isCSVImportPopupOpen, setIsCSVImportPopupOpen] = useState(false);
  const [isImportingCSV, setIsImportingCSV] = useState(false);
  const [csvImportResponse, setCSVImportResponse] = useState('');
  const [csvImportErrors, setCSVImportErrors] = useState<string[]>([]);
  const [csvImportStage, setCSVImportStage] = useState('');
  const [csvImportProgress, setCSVImportProgress] = useState(0);
  const [showCSVServerProgress, setShowCSVServerProgress] = useState(false);
  const csvInputRef = useRef<HTMLInputElement | null>(null);

  const resetImportState = () => {
    // Nollställer popupens importresultat så nästa körning startar rent.
    setCSVImportResponse('');
    setCSVImportErrors([]);
    setCSVImportStage('');
    setCSVImportProgress(0);
    setShowCSVServerProgress(false);
  };

  const openCSVImportPopup = () => {
    resetImportState();
    setIsCSVImportPopupOpen(true);
  };

  const closeCSVImportPopup = () => {
    setIsCSVImportPopupOpen(false);
    setIsImportingCSV(false);
    resetImportState();
  };

  const handleCSVUploadClick = () => {
    csvInputRef.current?.click();
  };

  const handleCSVSelected = async (e: FileInputChangeEvent) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setCSVImportResponse('Fel: välj en giltig .csv-fil.');
      setCSVImportErrors([]);
      e.target.value = '';
      return;
    }

    setIsImportingCSV(true);
    setCSVImportResponse('');
    setCSVImportErrors([]);
    setCSVImportProgress(0);
    setShowCSVServerProgress(true);

    let serverProgressTimer: ReturnType<typeof setInterval> | null = null;
    let currentVisualProgress = 0;
    const updateVisualProgress = (next: number) => {
      currentVisualProgress = next;
      setCSVImportProgress(next);
    };

    try {
      // Steg 1: skapa jobb + signerad upload-URL via backend.
      setCSVImportStage('Förbereder uppladdning...');
      const session = await createHistoricalImportSession(file.name);
      updateVisualProgress(2);

      // Steg 2: direktuppladdning till Supabase Storage (undviker Vercel 413-limit).
      setCSVImportStage('Laddar upp filen till lagring...');
      await uploadHistoricalCsvToStorage(session.uploadUrl, file, (percent) => {
        const totalProgress = (percent / 100) * 10;
        updateVisualProgress(Math.round(totalProgress));
      });

      updateVisualProgress(10);
      setCSVImportStage('Importerar rader på servern...');

      serverProgressTimer = setInterval(() => {
        setCSVImportProgress((prev) => {
          if (prev >= 95) {
            currentVisualProgress = 95;
            return 95;
          }

          const next = Math.min(95, prev + 1);
          currentVisualProgress = next;
          return next;
        });
      }, 350);

      const result = await runHistoricalImport(session.jobId);

      if (serverProgressTimer) {
        clearInterval(serverProgressTimer);
        serverProgressTimer = null;
      }

      setCSVImportStage('Slutför import...');
      const toNinetyFiveStart = Math.max(11, currentVisualProgress + 1);
      for (let p = toNinetyFiveStart; p <= 95; p++) {
        updateVisualProgress(p);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }

      for (let p = 96; p <= 100; p++) {
        updateVisualProgress(p);
        await new Promise((resolve) => setTimeout(resolve, 140));
      }

      setCSVImportStage('Import slutförd!');
      setCSVImportResponse(
        `Import klar!\n${result.result.rowsFound} rader lästa.\n${result.result.insertedRows} rader skrivna till Historical_shipment.\n${result.result.paketburRowsUpdated || 0} paketburspriser uppdaterade.\n${result.result.filteredOutRows} rader bortfiltrerade (viktklass 20 eller lägre).\n${result.result.nonPositiveRows || 0} rader bortfiltrerade (makuleringar och nollade rader).\n${result.result.replacedRows || 0} äldre rader ersatta av nyare priser.`,
      );
      setCSVImportErrors([]);
    } catch (error) {
      // Frontend visar endast kontrollerat felmeddelande från API:t.
      setCSVImportStage('Importen misslyckades.');
      const message = error instanceof Error ? error.message : 'Oväntat fel';
      setCSVImportResponse(`Import misslyckades: ${message}`);
      setCSVImportErrors([]);
    } finally {
      if (serverProgressTimer) {
        clearInterval(serverProgressTimer);
      }
      setIsImportingCSV(false);
      e.target.value = '';
    }
  };

  const csvOutputText = csvImportResponse
    ? [
        csvImportResponse,
        ...(csvImportErrors.length > 0 ? ['', 'Detaljer:', ...csvImportErrors] : []),
      ].join('\n')
    : '';

  return {
    // Exponerar minsta möjliga API till admin-sidan.
    csvInputRef,
    isCSVImportPopupOpen,
    isImportingCSV,
    csvImportStage,
    csvImportProgress,
    showCSVServerProgress,
    csvOutputText,
    openCSVImportPopup,
    closeCSVImportPopup,
    handleCSVUploadClick,
    handleCSVSelected,
  };
}
