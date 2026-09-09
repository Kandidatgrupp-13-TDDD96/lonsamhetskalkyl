import type {
	ConsignmentDetail,
	ConsignmentListItem,
	EquipageItem,
	LineItem,
} from "@/lib/ilogTypes";
import type { User, Message } from "@/lib/databaseTypes";
import type {
	BasicResponse,
	IlogResponse,
	MessageResponse,
	TokenResponse,
} from "@/lib/returnTypes";
import { Json } from "./supabaseServerSchema";

type HistoricalImportResponse = {
	columnsFound: number;
	rowsFound: number;
	insertedRows: number;
	filteredOutRows: number;
	nonPositiveRows: number;
	replacedRows: number;
	paketburRowsUpdated?: number;
};

// ============================================================
// Auth
// ============================================================

/**
 * Sign up funktion för supabase
 */
export const signUpProcedure = async (email: string): Promise<BasicResponse<null>> => {
	const response = await fetch(`/api/signup?email=${encodeURIComponent(email)}`, {
		method: "GET",
	});

	if (!response.ok) throw new Error((await response.json()).message);

	return (await response.json()) as BasicResponse<null>;
};

export const loginProcedure = async (email: string, password: string, rememberMe: boolean): Promise<BasicResponse<null>> => {
	const response = await fetch(`/api/login`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		}, body: JSON.stringify({ email, password, rememberMe }),
	});

	if (!response.ok) throw new Error((await response.json()).message);

	return (await response.json()) as BasicResponse<null>;
}

// ============================================================
// Users
// ============================================================

/**
 * Getter för alla användare i User-tabellen i supabase. Policies gäller, se Supabase
 */
export const getAllUsers = async (): Promise<BasicResponse<User[]>> => {
	const response = await fetch("/api/users", {
		method: "GET",
	});

	if (!response.ok) throw new Error((await response.json()).message);
	return (await response.json()) as BasicResponse<User[]>;
};

/**
 * Getter för den nuvarande inloggande användaren.
 * VARNING: Odefinierat beteende om det inte är någon inloggad (alltså om ingen cookie med token finns)
 * pallar inte detta just nu klockan är 2am
 */
export const getCurrentlySignedInUser = async (): Promise<BasicResponse<User>> => {
	const response = await fetch("/api/users/get/currentUser", {
		method: "GET",
	});

	if (!response.ok) throw new Error((await response.json()).message);
	return (await response.json()) as BasicResponse<User>;
}

/**
 * User tabell:
 * getUser - tar id som input och returnerar all data om en användare i User (id, email, roll osv)
 * setThreshold - tar id och sätter threshold-värde i User
 * deleteUser - tar id och raderar användaren från User
 * setEmail - tar id och sätter nytt email-värde. Måste nog skicka extra verifieringsmejl (och också sätta email_verified = False)
 * setFilters - tar id och sätter filter-json. Förmodligen där ett element är område, annat är tema (ljus/mörk) osv.
 * setPassword - tar id, dubbelkoll att inloggad användare är samma som id, och sätter nytt lösenord. Kanske finns någon funktion i supabase.auth
 * 
 */

/**
 * Hämtar information om en användare baserat på id. Policies gäller, se supabase.
 * @param id 
 * @returns BasicResponse<User>
 */
export const getUser = async (id: string): Promise<BasicResponse<User>> => {
	const response = await fetch(`/api/users/get/user?userId=${encodeURIComponent(id)}`, {
		method: "GET",
	});

	if (!response.ok) throw new Error((await response.json()).message);
	return (await response.json()) as BasicResponse<User>;
}


// NOT DONE YET
export const setEmail = async (id: string, newEmail: string): Promise<BasicResponse<null>> => {
	const response = await fetch("/api/users/set/email", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ userId: id, newEmail }),
	});

	if (!response.ok) throw new Error((await response.json()).message);
	return (await response.json()) as BasicResponse<null>;
}

/**
 * Sätter filter-json för angivet userId. Admin kan sätta filters för alla användare, vanliga användare kan bara sätta för sig själva.
 * VARNING: Odefinierat beteende om det inte är någon inloggad (alltså om ingen cookie med token finns)
 * @param id - id för användaren som ska få sina filters uppdaterade
 * @param filters - Json-objekt med filterdata. Upp till frontend att bestämma struktur. Kanske något i stil med { theme: "dark", area: "stockholm" } eller så.
 * @returns BasicResponse<null>
 */
export const setFilters = async (id: string, filters: Json): Promise<BasicResponse<null>> => {
	const response = await fetch("/api/users/set/filters", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ userId: id, filters }),
	});

	if (!response.ok) throw new Error((await response.json()).message);
	return (await response.json()) as BasicResponse<null>;
}

export const forgotPassword = async (email: string): Promise<BasicResponse<null>> => {
	const response = await fetch("/api/auth/forgot-password", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email }),
	});

	if (!response.ok) throw new Error((await response.json()).message);
	return (await response.json()) as BasicResponse<null>;
}

// NOT DONE YET
export const setPassword = async (currentPassword: string, newPassword: string): Promise<BasicResponse<null>> => {
	const response = await fetch("/api/users/set/password", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ currentPassword, newPassword }),
	});

	if (!response.ok) throw new Error((await response.json()).message);
	return (await response.json()) as BasicResponse<null>;
}

/**
 * Deletes a user based on id. Only admins can do this.
 * VARNING: Odefinierat beteende om det inte är någon inloggad (alltså om ingen cookie med token finns)
 * @param id 
 * @returns 
 */
export const deleteUser = async (id: string): Promise<BasicResponse<null>> => {
	const response = await fetch("/api/users/delete/user", {
		method: "DELETE",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ userId: id }),
	});

	if (!response.ok) throw new Error((await response.json()).message);
	return (await response.json()) as BasicResponse<null>;
}


// ============================================================
// iLog data
// ============================================================


/**
 * Hämtar alla iLog-linjer for aktuell grupp.
 */
export const getIlogLines = async (): Promise<IlogResponse<LineItem[]>> => {
	const response = await fetch("/api/ilog/lines", { method: "GET" });

	if (!response.ok) {
		throw new Error("Request failed: " + (await response.text()));
	}

	return (await response.json()) as IlogResponse<LineItem[]>;
};

/**
 * Hämtar lista över ekipage (fordon/transport-enheter).
*/
export const getIlogEquipages = async (): Promise<IlogResponse<EquipageItem[]>> => {
	const response = await fetch("/api/ilog/equipages", { method: "GET" });

	if (!response.ok) {
		throw new Error("Request failed: " + (await response.text()));
	}

	return (await response.json()) as IlogResponse<EquipageItem[]>;
};

/**
 * Hämtar bokningar (consignments) för ett ekipage på ett givet datum.
 */
export const getIlogConsignments = async (
	date: string,
	equipageId: number,
	signal?: AbortSignal
): Promise<IlogResponse<ConsignmentListItem[]>> => {
	const params = new URLSearchParams({
		date,
		equipageId: String(equipageId),
	});

	const response = await fetch(`/api/ilog/consignments?${params.toString()}`, {
		method: "GET",
		signal,
	});

	if (!response.ok) {
		throw new Error("Request failed: " + (await response.text()));
	}

	return (await response.json()) as IlogResponse<ConsignmentListItem[]>;
};

/**
 * Hämtar full detalj för en enskild bokning/konsignment.
 */
export const getIlogConsignment = async (
	consignmentId: number
): Promise<IlogResponse<ConsignmentDetail>> => {
	const response = await fetch(
		`/api/ilog/consignment?consignmentId=${encodeURIComponent(String(consignmentId))}`,
		{
			method: "GET",
		}
	);

	if (!response.ok) {
		throw new Error("Request failed: " + (await response.text()));
	}

	return (await response.json()) as IlogResponse<ConsignmentDetail>;
};


// ============================================================
// Profitability simulation
// ============================================================
export type ProfitabilityValue = {
  step_used: number;

  // Pris inklusive tillägg.
  estimated_revenue: number;

  // Pris utan tillägg.
  base_revenue?: number;

  addon_total?: number;
  addons?: ProfitabilityAddon[];

  addon_warnings?: Array<{
    code: string;
    message: string;
  }>;

  detail?: string;

  // Befintliga Jaro-fält som används i Home.
  best_score?: number;
  best_name?: string;
};

export type ProfitabilityResponse = {
	success: boolean;
	value?: ProfitabilityValue;
	error?: string;
	detail?: string;
};

export type NameMatchResponse = {
	best_name: string;
	best_score: number;
}

export type NameTranslationResponse = {
	translations: string[];
}

export const getNameTranslations = async (senderName: string, receiverName: string): Promise<BasicResponse<NameTranslationResponse>> => {
	const params = new URLSearchParams({ senderName, receiverName });
	const response = await fetch(`/api/profitability/name-translations?${params.toString()}`, {
		method: "GET",
	});

	if (!response.ok) {
		const error = await response.json() as { message?: string };
		throw new Error(error.message || "Request failed");
	}

	return (await response.json()) as BasicResponse<NameTranslationResponse>;
}
export type ProfitabilityAddon = {
  id: number;

  type:
    | "orttillagg"
    | "storstadstillagg"
    | "balanstillagg"
    | "tidtillagg"
    | "hvotillagg"
    | "dmttillagg"
    | "styckegodstillagg";

  direction:
    | "from"
    | "to"
    | "route";

  name: string;
  amount: number;
  class: number | null;

  region:
    | "stockholm"
    | "goteborg"
    | null;

  lookupSource:
    | "taxepunkt"
    | "postort"
    | "name"
    | "name_linjerel"
    | "dmt_rule"
    | "none";

  matchedTaxPoint: string | null;
  matchedCity: string | null;
};


export const calculateProfitability = async (
  consignment: ConsignmentListItem,
  useEntireName = false,
): Promise<ProfitabilityResponse> => {

    const consignmentWithLineRelation = consignment as ConsignmentListItem & {
        linjerel?: string | null;
        linjeRel?: string | null;
        lineRelation?: string | null;
        line_relation?: string | null;
    };

    const lineRelation =
        consignmentWithLineRelation.linjerel
        || consignmentWithLineRelation.linjeRel
        || consignmentWithLineRelation.lineRelation
        || consignmentWithLineRelation.line_relation
        || consignment.zoneName
        || "";

    const params = new URLSearchParams({
        consignmentId: String(consignment.consignmentId || 0),
        customerName: consignment.customerName || "",
        destinationCity: consignment.destinationCity || "",
        senderName: consignment.senderName || "",
        pickupLocationName: consignment.pickupLocationName || "",
        receiverName: consignment.receiverName || "",
        destinationLocationName: consignment.destinationLocationName || "",
        weight: String(consignment.weight || 0),
        zoneName: consignment.zoneName || "",
        linjerel: lineRelation,
        consignmentProperties: consignment.consignmentProperties || "",
        pickupLocationCity: consignment.pickupLocationCity || "",
        taxPointRelation: consignment.taxPointRelation || "",
		pickupPostalCode: consignment.pickupPostalCode || "",
    	destinationPostalCode: consignment.destinationPostalCode || "",
		invoiceStatus: consignment.invoiceStatus || "",
        internalPrice: String(consignment.internalPrice || 0),
		paketburar: String(consignment.paketburar || 0),
		useEntireName: String(useEntireName),
    });

    const url = `/api/profitability?${params.toString()}`;

    const response = await fetch(url, {
        method: "GET",
        cache: "no-store", 
    });

    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
        throw new Error("API:t returnerade inte JSON.");
    }

    const data = await response.json();
    return data as ProfitabilityResponse;
};

export const getBestNameMatch = async (name: string): Promise<BasicResponse<NameMatchResponse>> => {
	
	const params = new URLSearchParams({ name });
	const response = await fetch(`/api/profitability/jaro-estimation?${params.toString()}`, {
		method: "GET",
	});

	if (!response.ok) {
		const error = await response.json() as { message?: string };
		throw new Error(error.message || "Request failed");
	}

	return (await response.json()) as BasicResponse<NameMatchResponse>;
}


// ============================================================
// DMT settings
// ============================================================

export type DmtSettingsRule = {
  id?: number | null;
  ruleType: string;
  ruleKey: string;
  kmFrom: number | null;
  kmTo: number | null;
  percentage: number;
};

export type DmtSettingsData = {
  validFrom: string;
  validTo: string;
  rules: DmtSettingsRule[];
};

export type DmtImportSummary = {
  inserted: number;
  updated: number;
  skipped: number;
  deletedDuplicates?: number;
  periods: number;
  sheets: number;
};

export type DmtImportResult = {
  summary: DmtImportSummary;
  settings: DmtSettingsData;
};

function getDmtErrorMessage(json: unknown, fallback: string): string {
  if (
    json
    && typeof json === "object"
    && "message" in json
    && typeof (json as { message?: unknown }).message === "string"
  ) {
    return (json as { message: string }).message;
  }

  return fallback;
}

export const getDmtSettings = async (): Promise<DmtSettingsData> => {
  const response = await fetch("/api/dmt", {
    method: "GET",
    cache: "no-store",
  });
  const json = await response.json();

  if (!response.ok || !json.status) {
    throw new Error(getDmtErrorMessage(json, "Kunde inte hämta DMT-inställning."));
  }

  return json.data as DmtSettingsData;
};

export const uploadDmtSettingsFile = async (file: File): Promise<DmtImportResult> => {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/dmt", {
    method: "POST",
    body: formData,
  });
  const json = await response.json();

  if (!response.ok || !json.status) {
    throw new Error(getDmtErrorMessage(json, "Kunde inte importera DMT-filen."));
  }

  return json.data as DmtImportResult;
};

export const importDmtSettingsText = async (pastedText: string): Promise<DmtImportResult> => {
  const response = await fetch("/api/dmt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pastedText }),
  });
  const json = await response.json();

  if (!response.ok || !json.status) {
    throw new Error(getDmtErrorMessage(json, "Kunde inte importera inklistrad DMT-data."));
  }

  return json.data as DmtImportResult;
};

// ============================================================
// Analys (sparade nattprognoser)
// ============================================================

export type ForecastAnalyticsRow = {
	id: number;
	forecast_date: string;
	equipage_id: number;
	equipage_name: string;
	total_weight_kg: number;
	total_flm: number;
	total_estimated_revenue: number;
	consignment_count: number;
	created_at: string;
	updated_at: string;
};

export type ForecastEquipageOption = {
	id: number;
	name: string;
};

const buildForecastParams = (
	from: string,
	to: string,
	equipageIds?: number[],
): URLSearchParams => {
	const params = new URLSearchParams({ from, to });
	if (equipageIds && equipageIds.length > 0) {
		params.set("equipageIds", equipageIds.join(","));
	}
	return params;
};

/**
 * Hämtar ekipage som förekommer i sparad prognosdata. Endast admin.
 */
export const getForecastEquipages = async (): Promise<BasicResponse<ForecastEquipageOption[]>> => {
	const response = await fetch("/api/analytics/equipages", { method: "GET" });

	if (!response.ok) throw new Error((await response.json()).message);
	return (await response.json()) as BasicResponse<ForecastEquipageOption[]>;
};

/**
 * Hämtar sparade nattprognoser för ett datumintervall. Endast admin.
 */
export const getForecastAnalytics = async (
	from: string,
	to: string,
	equipageIds?: number[],
): Promise<BasicResponse<ForecastAnalyticsRow[]>> => {
	const params = buildForecastParams(from, to, equipageIds);
	const response = await fetch(`/api/analytics/forecasts?${params.toString()}`, {
		method: "GET",
	});

	if (!response.ok) throw new Error((await response.json()).message);
	return (await response.json()) as BasicResponse<ForecastAnalyticsRow[]>;
};

/**
 * Bygger nedladdningslänk för Excel-exporten av prognosdata.
 */
export const buildForecastExportUrl = (
	from: string,
	to: string,
	equipageIds?: number[],
): string => {
	const params = buildForecastParams(from, to, equipageIds);
	return `/api/analytics/forecasts/export?${params.toString()}`;
};

// ============================================================
// Historical import
// ============================================================

/**
 * Hämtar signerad upload-URL och jobId för historisk import.
 */
export const createHistoricalImportSession = async (filename: string): Promise<{
	jobId: string;
	uploadUrl: string;
	storagePath: string;
}> => {
	const response = await fetch('/api/import-historical', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'create-upload-session', filename }),
	});

	if (!response.ok) {
		const error = await response.json() as { error?: string };
		throw new Error(error.error || 'Kunde inte skapa upload-session');
	}

	return (await response.json()) as { jobId: string; uploadUrl: string; storagePath: string };
};

/**
 * Laddar upp CSV-fil direkt till Supabase Storage via signerad URL.
 */
export const uploadHistoricalCsvToStorage = async (
	uploadUrl: string,
	file: File,
	onProgress?: (percent: number) => void,
): Promise<void> => {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();

		xhr.upload.addEventListener('progress', (event) => {
			if (event.lengthComputable) {
				const percent = Math.round((event.loaded / event.total) * 100);
				onProgress?.(percent);
			}
		});

		xhr.addEventListener('load', () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				resolve();
			} else {
				reject(new Error(`Upload misslyckades: HTTP ${xhr.status}`));
			}
		});

		xhr.addEventListener('error', () => reject(new Error('Upload-fel')));
		xhr.addEventListener('abort', () => reject(new Error('Upload avbruten')));

		xhr.open('PUT', uploadUrl);
		// Content-Type måste matcha fil-typen
		xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
		xhr.send(file);
	});
};

/**
 * Startar historisk import från tidigare uppladdad CSV i Storage.
 */
export const runHistoricalImport = async (jobId: string): Promise<{
	jobId: string;
	status: string;
	result: HistoricalImportResponse;
}> => {
	const response = await fetch('/api/import-historical', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'start-import', jobId }),
	});

	if (!response.ok) {
		const error = await response.json() as { error?: string };
		throw new Error(error.error || 'Kunde inte starta import');
	}

	return (await response.json()) as {
		jobId: string;
		status: string;
		result: HistoricalImportResponse;
	};
};

export async function getIlogUnassignedConsignments(
  date: string,
  lineId: number,
  lineType: "ZONE" | "ZONEFILTER" | "ZONEGROUP",
) {
  const response = await fetch(
    `/api/ilog/unassigned-consignments?date=${encodeURIComponent(date)}&lineId=${lineId}&lineType=${encodeURIComponent(lineType)}`,
    {
      method: "GET",
      cache: "no-store",
    },
  );

  return response.json();
}

// ============================================================
// Messaging system
// ============================================================

/**
 * Skickar ett meddelande. Bara admins kan skicka meddelanden. 
 * @param body sträng på meddelandets innehåll. Max 1000 tecken, annars nekas requesten
 * @returns Promise på BasicResponse<null>. Hur det gick att skicka meddelandet
 * @throws Error med felmeddelande från API:t om HTTP status inte är 2xx, t.ex. om body är för långt eller om användaren inte är admin.
 */
export const addMessage = async (body: string): Promise<BasicResponse<null>> => {

	const response = await fetch("/api/messages/add", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ body })
	});

	if (!response.ok) throw new Error((await response.json()).message);

	return (await response.json()) as BasicResponse<null>;
}

/**
 * Hämtar alla meddelanden inom angiven page sorterat efter datum skickat. Uppdaterar när inloggade användaren senast läste meddelanden
 * @param page sida att hämta. Börjar på 1 sedan 2 osv.
 * @param pageSize Hur många meddelanden som finns på en sida. Max 100 annars nekas requesten
 * @returns Promise på MessageResponse. De två viktigaste attributerna är:
 * 		- last_read_messages vilket är tiden användaren senast anropade getMessages. Borde kunna översättas till riktig tid med "new Date(last_read_message)"
 * 		- messages lista på alla meddelanden på denna page. Denna lista är pageSize lång
 * @throws Error med felmeddelande från API:t om HTTP status inte är 2xx, t.ex om pageSize är för stor
 */
export const getMessages = async (page: number, pageSize: number): Promise<MessageResponse> => {

	const params = new URLSearchParams({
		page: String(page),
		pageSize: String(pageSize),
	});

	const response = await fetch(`/api/messages/get/messages?${params.toString()}`, {
		method: "GET"
	});

	if (!response.ok) throw new Error((await response.json()).message);

	return (await response.json()) as MessageResponse;


}

/**
 * Hämtar hur många olästa meddelanden den inloggade användaren har.
 * @returns Promise på BasicResponse där data-fältet har antal olästa meddelanden
 * @throws Error med felmeddelande från API:t om HTTP status inte är 2xx
 */
export const getAmountOfUnreadMessages = async (): Promise<BasicResponse<number>> => {

	const response = await fetch("/api/messages/get/unreadMessages", {
		method: "GET"
	});

	if (!response.ok) throw new Error((await response.json()).message);

	return (await response.json()) as BasicResponse<number>;
}


/**
 * Tar bort ett meddelande baserat på messageId. Bara admins kan göra detta.
 * @param messageId ID för meddelandet som ska raderas
 * @returns Promise på BasicResponse<null>. Hur det gick att radera meddelandet
 * @throws Error med felmeddelande från API:t om HTTP status inte är 2xx, t.ex. om messageId inte finns eller om användaren inte är admin.
 */
export const deleteMessage = async (messageId: number): Promise<BasicResponse<null>> => {

	const paramMessageId = encodeURIComponent(String(messageId));
	const response = await fetch(`/api/messages/delete?messageId=${paramMessageId}`, {
		method: "DELETE",
	});

	if (!response.ok) throw new Error((await response.json()).message);

	return (await response.json()) as BasicResponse<null>;
}

/**
 * Hämtar hur många sidor som finns givet hur många meddelanden som finns på en sida (pageSize)
 * @param pageSize Antal meddelanden som visas på varje sida. Max 100 (lib/backend/utils:MAX_NUMBER_OF_MESSAGES_PER_PAGE), annars nekas requesten.
 * @return Promise på BasicResponse<number>. Antal sidor som finns givet pageSize. Returnernas i data-fältet
 * @throws Error med felmeddelande från API:t om HTTP status inte är 2xx, t.ex. om pageSize är större än 100.
 */
export const getAmountOfPages = async (pageSize: number): Promise<BasicResponse<number>> => {

	const paramPageSize = encodeURIComponent(String(pageSize));
	const response = await fetch(`/api/messages/get/amountOfPages?pageSize=${paramPageSize}`, {
		method: "GET",
	});

	if (!response.ok) throw new Error((await response.json()).message);

	return (await response.json()) as BasicResponse<number>;
}
