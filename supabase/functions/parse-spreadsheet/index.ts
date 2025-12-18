import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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

// Find column indices by header name (case-insensitive, fuzzy matching)
function findColumnIndex(headers: string[], possibleNames: string[]): number {
  const normalizedHeaders = headers.map(h => h.toLowerCase().trim());
  
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
    console.log("Not enough rows in spreadsheet");
    return [];
  }
  
  const headers = rows[0];
  console.log("Headers found:", headers);
  
  // Find relevant columns
  const titleCol = findColumnIndex(headers, ['title', 'job title', 'position', 'role', 'job']);
  const companyCol = findColumnIndex(headers, ['company', 'employer', 'organization', 'org']);
  const descriptionCol = findColumnIndex(headers, ['description', 'job description', 'desc', 'details', 'requirements', 'summary']);
  const locationCol = findColumnIndex(headers, ['location', 'city', 'place', 'office']);
  const urlCol = findColumnIndex(headers, ['url', 'link', 'job url', 'apply', 'apply link']);
  
  console.log("Column indices:", { titleCol, companyCol, descriptionCol, locationCol, urlCol });
  
  // If no description column found, try to use the largest text column
  let fallbackDescCol = -1;
  if (descriptionCol === -1) {
    let maxLength = 0;
    for (let i = 0; i < headers.length; i++) {
      if (i === titleCol || i === companyCol || i === locationCol || i === urlCol) continue;
      
      // Check average length in this column
      const avgLength = rows.slice(1).reduce((sum, row) => sum + (row[i]?.length || 0), 0) / (rows.length - 1);
      if (avgLength > maxLength) {
        maxLength = avgLength;
        fallbackDescCol = i;
      }
    }
    console.log("Using fallback description column:", fallbackDescCol);
  }
  
  const effectiveDescCol = descriptionCol !== -1 ? descriptionCol : fallbackDescCol;
  
  const jobs: JobEntry[] = [];
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    
    const title = titleCol !== -1 ? row[titleCol]?.trim() : '';
    const company = companyCol !== -1 ? row[companyCol]?.trim() : '';
    const description = effectiveDescCol !== -1 ? row[effectiveDescCol]?.trim() : '';
    const location = locationCol !== -1 ? row[locationCol]?.trim() : undefined;
    const url = urlCol !== -1 ? row[urlCol]?.trim() : undefined;
    
    // Skip rows without meaningful content
    if (!title && !description) continue;
    
    // Create a display title if none exists
    const displayTitle = title || (description ? `Job ${i}` : 'Untitled');
    
    jobs.push({
      id: `job-${i}`,
      title: displayTitle,
      company: company || 'Unknown Company',
      description: description || `${title} at ${company}`,
      location,
      url
    });
  }
  
  console.log(`Extracted ${jobs.length} jobs from spreadsheet`);
  return jobs;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    console.log("parse-spreadsheet function called");
    
    const contentType = req.headers.get('content-type') || '';
    let fileContent: string;
    let fileName: string;
    
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
      console.log("Processing file:", fileName);
      
      // For Excel files, we need special handling
      if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        // Excel files need binary parsing - for now return a helpful message
        // In production, you'd use a library like SheetJS
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Excel files (.xlsx/.xls) are not yet fully supported. Please export as CSV for best results.',
            suggestion: 'In Excel or Google Sheets, go to File > Download > CSV (.csv)'
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Read CSV as text
      fileContent = await file.text();
    } else {
      // JSON body with content
      const body = await req.json();
      fileContent = body.content;
      fileName = body.fileName || 'data.csv';
    }
    
    if (!fileContent || fileContent.trim().length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Empty file content' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Parse CSV
    const rows = parseCSV(fileContent);
    console.log(`Parsed ${rows.length} rows from CSV`);
    
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
          headers: rows[0]
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        jobs,
        totalRows: rows.length - 1,
        headers: rows[0]
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Error parsing spreadsheet:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to parse spreadsheet' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
