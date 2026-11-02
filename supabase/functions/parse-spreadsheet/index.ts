// deploy-stamp: 2026-07-04T18:44Z
// SheetJS stays at the registry's last build, 0.18.5 (before the
// prototype-pollution fix in 0.19.3 and the ReDoS fix in 0.20.2). Later builds
// are published only at cdn.sheetjs.com, a host Deno 2 refuses to import from
// by default, so scripts/check-functions.sh fails on it; moving up is the
// owner's call (S13-066). Until then a workbook is bounded below.
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { clientAddressOr } from "../_shared/client-address.ts";
// Quote-aware CSV rows and header matching that ignores empty headers
// (register L5-09).
import { findColumnIndex, parseCSV } from "./csv.ts";
// The size, time, row and per-address bounds (S13-066).
import { MAX_ROWS, MAX_UNZIPPED_BYTES, MAX_UPLOAD_BYTES, PER_ADDRESS_PER_HOUR, SHEETS_FETCH_MS, TooLarge, declaredTooLarge, looksZipped, readBodyCapped, readCapped, zipInflationRefusal } from "./limits.ts";

// Provable from outside without an upload: every response, the CORS preflight
// included, carries this in x-fn-build.
// 2026-11-03.1 (S13-066, fix/audit-rest-abuse): a 10 MB cap on every body,
// a per-address limiter, a timed and capped Google Sheets read, at most
// MAX_ROWS workbook rows.
// Also 2026-11-03.1 (the audit-rest fixer): the body is read through a byte
// count whether or not it declares its length, and a zipped workbook that
// unpacks past MAX_UNZIPPED_BYTES is refused before SheetJS reads it. The 15 s
// clock is the Google Sheets fetch's only.
const FN_BUILD = "parse-spreadsheet.2026-11-03.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'x-fn-build': FN_BUILD,
};

interface JobEntry {
  id: string;
  title: string;
  company: string;
  description: string;
  location?: string;
  url?: string;
}

// Parse Excel file into rows using SheetJS
function parseExcel(buffer: ArrayBuffer): string[][] {
  console.log("[parse-spreadsheet] Parsing Excel file with SheetJS");
  
  // Only the first sheet's first MAX_ROWS rows, values only: no formulae,
  // HTML or styles are built for cells nobody reads.
  const workbook = XLSX.read(buffer, { type: 'array', sheetRows: MAX_ROWS + 1, cellFormula: false, cellHTML: false, cellStyles: false });
  
  // Get the first sheet
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    console.log("[parse-spreadsheet] No sheets found in workbook");
    return [];
  }
  
  console.log(`[parse-spreadsheet] Reading sheet: ${firstSheetName}`);
  const worksheet = workbook.Sheets[firstSheetName];
  
  // Convert to array of arrays (rows)
  const rows: string[][] = XLSX.utils.sheet_to_json(worksheet, { 
    header: 1,
    defval: '',
    raw: false // Convert all values to strings
  });
  
  console.log(`[parse-spreadsheet] Parsed ${rows.length} rows from Excel`);
  return rows;
}

// Extract jobs from parsed rows
function extractJobs(rows: string[][]): JobEntry[] {
  if (rows.length < 2) {
    console.log("[parse-spreadsheet] Not enough rows in spreadsheet");
    return [];
  }
  
  const headers = rows[0].map(h => String(h || ''));
  console.log("[parse-spreadsheet] Headers found:", headers);
  
  // Find relevant columns
  const titleCol = findColumnIndex(headers, ['title', 'job title', 'position', 'role', 'job']);
  const companyCol = findColumnIndex(headers, ['company', 'employer', 'organization', 'org']);
  const descriptionCol = findColumnIndex(headers, ['description', 'job description', 'desc', 'details', 'requirements', 'summary']);
  const locationCol = findColumnIndex(headers, ['location', 'city', 'place', 'office']);
  const urlCol = findColumnIndex(headers, ['url', 'link', 'job url', 'apply', 'apply link']);
  
  console.log("[parse-spreadsheet] Column indices:", { titleCol, companyCol, descriptionCol, locationCol, urlCol });
  
  // If no description column found, try to use the largest text column
  let fallbackDescCol = -1;
  if (descriptionCol === -1) {
    let maxLength = 0;
    for (let i = 0; i < headers.length; i++) {
      if (i === titleCol || i === companyCol || i === locationCol || i === urlCol) continue;
      
      // Check average length in this column
      const avgLength = rows.slice(1).reduce((sum, row) => sum + (String(row[i] || '').length), 0) / (rows.length - 1);
      if (avgLength > maxLength) {
        maxLength = avgLength;
        fallbackDescCol = i;
      }
    }
    console.log("[parse-spreadsheet] Using fallback description column:", fallbackDescCol);
  }
  
  const effectiveDescCol = descriptionCol !== -1 ? descriptionCol : fallbackDescCol;
  
  const jobs: JobEntry[] = [];
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    
    const title = titleCol !== -1 ? String(row[titleCol] || '').trim() : '';
    const company = companyCol !== -1 ? String(row[companyCol] || '').trim() : '';
    const description = effectiveDescCol !== -1 ? String(row[effectiveDescCol] || '').trim() : '';
    const location = locationCol !== -1 ? String(row[locationCol] || '').trim() : undefined;
    const url = urlCol !== -1 ? String(row[urlCol] || '').trim() : undefined;
    
    // Skip rows without meaningful content
    if (!title && !description) continue;
    
    // Create a display title if none exists
    const displayTitle = title || (description ? `Job ${i}` : 'Untitled');
    
    jobs.push({
      id: `job-${i}`,
      title: displayTitle,
      company: company || 'Unknown Company',
      description: description || `${title} at ${company}`,
      location: location || undefined,
      url: url || undefined
    });
  }
  
  console.log(`[parse-spreadsheet] Extracted ${jobs.length} jobs from spreadsheet`);
  return jobs;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  const tooLarge = (what: string) => new Response(
    JSON.stringify({ success: false, error: `${what} is too large. The limit is ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`, code: 'too_large' }),
    { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );

  try {
    console.log("[parse-spreadsheet] Function called");

    // A body past the cap is refused before a byte of it is parsed.
    if (declaredTooLarge(req.headers) !== null) return tooLarge('This file');

    // One address, PER_ADDRESS_PER_HOUR requests an hour: the platform's
    // address, never a header the caller writes. A limiter that cannot be
    // read lets the request through, as parse-pdf does: a broken counter
    // never takes the import away from everyone.
    const limiter = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const { data: allowed, error: rlError } = await limiter.rpc('check_rate_limit', {
      p_ip: clientAddressOr(req.headers),
      p_function: 'parse-spreadsheet',
      p_max_requests: PER_ADDRESS_PER_HOUR,
      p_window_minutes: 60,
    });
    if (rlError) {
      console.error("[parse-spreadsheet] rate limit check error:", rlError.message ?? rlError);
    } else if (allowed === false) {
      return new Response(
        JSON.stringify({ success: false, error: 'Too many spreadsheets from your network this hour. Please try again later.', code: 'rate_limited_function' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '3600' } }
      );
    }

    const contentType = req.headers.get('content-type') || '';
    let rows: string[][] = [];
    let fileName = 'data.csv';

    // The body, read only up to the cap, declared length or not (a chunked
    // upload was buffered whole by formData() before its size was checked).
    let rawBody: Uint8Array<ArrayBuffer>;
    try {
      rawBody = await readBodyCapped(req);
    } catch (e) {
      if (e instanceof TooLarge) return tooLarge('This file');
      throw e;
    }
    const capped = new Response(rawBody, { headers: { 'content-type': contentType } });
    
    if (contentType.includes('multipart/form-data')) {
      const formData = await capped.formData();
      const file = formData.get('file') as File;
      
      if (!file) {
        return new Response(
          JSON.stringify({ success: false, error: 'No file provided' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      fileName = file.name.toLowerCase();
      console.log("[parse-spreadsheet] Processing file:", fileName, "Size:", file.size);
      if (file.size > MAX_UPLOAD_BYTES) return tooLarge('This file');
      
      // Handle Excel files
      if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        try {
          const buffer = await file.arrayBuffer();
          // A zipped workbook is measured before SheetJS inflates it: its
          // row cap does not bound the inflation of sharedStrings or styles.
          const bytes = new Uint8Array(buffer);
          if (looksZipped(bytes)) {
            const refusal = await zipInflationRefusal(bytes);
            if (refusal === 'too_large') {
              return new Response(
                JSON.stringify({ success: false, error: `This workbook unpacks to more than ${MAX_UNZIPPED_BYTES / (1024 * 1024)} MB, which is more than we read. Export it as CSV and upload that instead.`, code: 'too_large' }),
                { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }
            if (refusal === 'corrupt') throw new Error('the zip directory or an entry could not be read');
          }
          rows = parseExcel(buffer);
        } catch (excelError) {
          console.error("[parse-spreadsheet] Excel parsing error:", excelError);
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'Failed to parse Excel file. Please ensure the file is not corrupted.',
              suggestion: 'You can also try exporting as CSV: File > Download > CSV (.csv)'
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } else {
        // Read CSV as text
        const fileContent = await file.text();
        if (!fileContent || fileContent.trim().length === 0) {
          return new Response(
            JSON.stringify({ success: false, error: 'Empty file content' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        rows = parseCSV(fileContent);
      }
    } else {
      // JSON body - could be content or Google Sheets URL
      const body = await capped.json();
      
      // Handle Google Sheets URL
      if (body.googleSheetsUrl) {
        const sheetsUrl = body.googleSheetsUrl;
        console.log("[parse-spreadsheet] Processing Google Sheets URL:", sheetsUrl);
        
        // Extract the spreadsheet ID from various URL formats
        const sheetIdMatch = sheetsUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        if (!sheetIdMatch) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'Invalid Google Sheets URL. Please copy the URL from your browser address bar.',
              suggestion: 'The URL should look like: https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/...'
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        const sheetId = sheetIdMatch[1];
        console.log("[parse-spreadsheet] Extracted sheet ID:", sheetId);
        
        // Fetch the sheet as CSV (works for publicly shared sheets)
        const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
        console.log("[parse-spreadsheet] Fetching from:", exportUrl);
        
        try {
          const response = await fetch(exportUrl, {
            headers: {
              'Accept': 'text/csv',
            },
            signal: AbortSignal.timeout(SHEETS_FETCH_MS),
          });
          
          if (!response.ok) {
            console.error("[parse-spreadsheet] Google Sheets fetch failed:", response.status, response.statusText);
            return new Response(
              JSON.stringify({ 
                success: false, 
                error: 'Could not access Google Sheet. Make sure it\'s shared with "Anyone with the link".',
                suggestion: 'Click Share → Change to "Anyone with the link" → Copy the URL'
              }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          
          const csvContent = await readCapped(response);
          console.log("[parse-spreadsheet] Fetched CSV content, length:", csvContent.length);
          
          if (!csvContent || csvContent.trim().length === 0) {
            return new Response(
              JSON.stringify({ success: false, error: 'Google Sheet appears to be empty' }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          
          rows = parseCSV(csvContent);
        } catch (fetchError) {
          if (fetchError instanceof TooLarge) return tooLarge('This Google Sheet');
          console.error("[parse-spreadsheet] Google Sheets fetch error:", fetchError);
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'Failed to fetch Google Sheet. Please check the URL and sharing settings.',
              suggestion: 'Make sure the sheet is shared with "Anyone with the link"'
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } else {
        // Regular content-based parsing
        const fileContent = body.content;
        fileName = body.fileName || 'data.csv';
        
        if (!fileContent || typeof fileContent !== 'string' || fileContent.trim().length === 0) {
          return new Response(
            JSON.stringify({ success: false, error: 'Empty file content' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        if (fileContent.length > MAX_UPLOAD_BYTES) return tooLarge('This file');
        
        rows = parseCSV(fileContent);
      }
    }
    
    console.log(`[parse-spreadsheet] Parsed ${rows.length} rows`);
    
    if (rows.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'No data found in file' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Extract jobs
    const jobs = extractJobs(rows);
    
    if (jobs.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Could not find job listings in the spreadsheet. Make sure your spreadsheet has columns like "Title", "Company", and "Description".',
          headers: rows[0]?.map(h => String(h || ''))
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        jobs,
        totalRows: rows.length - 1,
        headers: rows[0]?.map(h => String(h || ''))
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('[parse-spreadsheet] Error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to parse spreadsheet' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
