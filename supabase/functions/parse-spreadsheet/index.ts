import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface JobEntry {
  id: string;
  title: string;
  company: string;
  description: string;
  location?: string;
  url?: string;
}

// Parse CSV content into rows
function parseCSV(content: string): string[][] {
  const lines = content.split(/\r?\n/);
  const result: string[][] = [];
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    // Handle quoted fields with commas
    const row: string[] = [];
    let inQuotes = false;
    let currentField = '';
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          currentField += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push(currentField.trim());
        currentField = '';
      } else {
        currentField += char;
      }
    }
    row.push(currentField.trim());
    result.push(row);
  }
  
  return result;
}

// Parse Excel file into rows using SheetJS
function parseExcel(buffer: ArrayBuffer): string[][] {
  console.log("[parse-spreadsheet] Parsing Excel file with SheetJS");
  
  const workbook = XLSX.read(buffer, { type: 'array' });
  
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

// Find column indices by header name (case-insensitive, fuzzy matching)
function findColumnIndex(headers: string[], possibleNames: string[]): number {
  const normalizedHeaders = headers.map(h => String(h || '').toLowerCase().trim());
  
  for (const name of possibleNames) {
    const index = normalizedHeaders.findIndex(h => 
      h.includes(name.toLowerCase()) || name.toLowerCase().includes(h)
    );
    if (index !== -1) return index;
  }
  
  return -1;
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
  
  try {
    console.log("[parse-spreadsheet] Function called");
    
    const contentType = req.headers.get('content-type') || '';
    let rows: string[][] = [];
    let fileName = 'data.csv';
    
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File;
      
      if (!file) {
        return new Response(
          JSON.stringify({ success: false, error: 'No file provided' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      fileName = file.name.toLowerCase();
      console.log("[parse-spreadsheet] Processing file:", fileName, "Size:", file.size);
      
      // Handle Excel files
      if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        try {
          const buffer = await file.arrayBuffer();
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
      const body = await req.json();
      
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
            }
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
          
          const csvContent = await response.text();
          console.log("[parse-spreadsheet] Fetched CSV content, length:", csvContent.length);
          
          if (!csvContent || csvContent.trim().length === 0) {
            return new Response(
              JSON.stringify({ success: false, error: 'Google Sheet appears to be empty' }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          
          rows = parseCSV(csvContent);
        } catch (fetchError) {
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
        
        if (!fileContent || fileContent.trim().length === 0) {
          return new Response(
            JSON.stringify({ success: false, error: 'Empty file content' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
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
