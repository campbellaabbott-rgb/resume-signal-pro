/**
 * Security Validation Test Suite
 * Run these tests during development to catch security issues early.
 * 
 * Usage: Import and call runSecurityTests() in development mode
 * or use in browser console: import('/src/lib/security-tests.ts').then(m => m.runSecurityTests())
 */

import {
  validateUUID,
  validateEmail,
  validateResumeText,
  validateStoreResume,
  validateSaveLead,
  uuidSchema,
  emailSchema,
  resumeTextSchema,
  industrySchema,
  atsScoreSchema,
} from './security-validation';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

interface TestSuite {
  name: string;
  results: TestResult[];
  passed: number;
  failed: number;
}

// Test runner helper
function runTest(name: string, testFn: () => boolean): TestResult {
  try {
    const passed = testFn();
    return { name, passed };
  } catch (error) {
    return { name, passed: false, error: String(error) };
  }
}

// UUID Validation Tests
function testUUIDValidation(): TestSuite {
  const results: TestResult[] = [];

  // Valid UUIDs
  results.push(runTest('Valid UUID lowercase', () => 
    validateUUID('a1b2c3d4-e5f6-7890-abcd-ef1234567890').valid === true
  ));

  results.push(runTest('Valid UUID uppercase', () => 
    validateUUID('A1B2C3D4-E5F6-7890-ABCD-EF1234567890').valid === true
  ));

  results.push(runTest('Valid UUID mixed case', () => 
    validateUUID('A1b2C3d4-E5f6-7890-AbCd-Ef1234567890').valid === true
  ));

  // Invalid UUIDs
  results.push(runTest('Empty string rejected', () => 
    validateUUID('').valid === false
  ));

  results.push(runTest('Null-like string rejected', () => 
    validateUUID('null').valid === false
  ));

  results.push(runTest('SQL injection attempt rejected', () => 
    validateUUID("'; DROP TABLE users; --").valid === false
  ));

  results.push(runTest('UUID with extra characters rejected', () => 
    validateUUID('a1b2c3d4-e5f6-7890-abcd-ef1234567890-extra').valid === false
  ));

  results.push(runTest('UUID missing segment rejected', () => 
    validateUUID('a1b2c3d4-e5f6-7890-abcd').valid === false
  ));

  results.push(runTest('UUID with wrong characters rejected', () => 
    validateUUID('g1b2c3d4-e5f6-7890-abcd-ef1234567890').valid === false
  ));

  results.push(runTest('UUID with spaces rejected', () => 
    validateUUID(' a1b2c3d4-e5f6-7890-abcd-ef1234567890 ').valid === false
  ));

  results.push(runTest('XSS attempt in UUID rejected', () => 
    validateUUID('<script>alert(1)</script>').valid === false
  ));

  const passed = results.filter(r => r.passed).length;
  return { name: 'UUID Validation', results, passed, failed: results.length - passed };
}

// Email Validation Tests
function testEmailValidation(): TestSuite {
  const results: TestResult[] = [];

  // Valid emails
  results.push(runTest('Standard email accepted', () => 
    validateEmail('test@example.com').valid === true
  ));

  results.push(runTest('Email with subdomain accepted', () => 
    validateEmail('user@mail.example.com').valid === true
  ));

  results.push(runTest('Email with plus sign accepted', () => 
    validateEmail('user+tag@example.com').valid === true
  ));

  results.push(runTest('Email with dots accepted', () => 
    validateEmail('first.last@example.com').valid === true
  ));

  // Invalid emails
  results.push(runTest('Empty email rejected', () => 
    validateEmail('').valid === false
  ));

  results.push(runTest('Email without @ rejected', () => 
    validateEmail('invalidemail.com').valid === false
  ));

  results.push(runTest('Email without domain rejected', () => 
    validateEmail('user@').valid === false
  ));

  results.push(runTest('Email without TLD rejected', () => 
    validateEmail('user@domain').valid === false
  ));

  results.push(runTest('SQL injection in email rejected', () => 
    validateEmail("test@example.com'; DROP TABLE users;--").valid === false
  ));

  results.push(runTest('XSS in email rejected', () => 
    validateEmail('<script>alert(1)</script>@example.com').valid === false
  ));

  results.push(runTest('Email over 255 chars rejected', () => 
    validateEmail('a'.repeat(250) + '@example.com').valid === false
  ));

  results.push(runTest('Email with newlines rejected', () => 
    validateEmail('test@example.com\nBcc: attacker@evil.com').valid === false
  ));

  const passed = results.filter(r => r.passed).length;
  return { name: 'Email Validation', results, passed, failed: results.length - passed };
}

// Resume Text Validation Tests
function testResumeValidation(): TestSuite {
  const results: TestResult[] = [];

  // Valid resumes
  results.push(runTest('Valid resume (50 chars min) accepted', () => 
    validateResumeText('A'.repeat(50)).valid === true
  ));

  results.push(runTest('Normal resume length accepted', () => 
    validateResumeText('A'.repeat(5000)).valid === true
  ));

  results.push(runTest('Max length resume (50000) accepted', () => 
    validateResumeText('A'.repeat(50000)).valid === true
  ));

  // Invalid resumes
  results.push(runTest('Empty resume rejected', () => 
    validateResumeText('').valid === false
  ));

  results.push(runTest('Too short resume (49 chars) rejected', () => 
    validateResumeText('A'.repeat(49)).valid === false
  ));

  results.push(runTest('Too long resume (50001 chars) rejected', () => 
    validateResumeText('A'.repeat(50001)).valid === false
  ));

  const passed = results.filter(r => r.passed).length;
  return { name: 'Resume Validation', results, passed, failed: results.length - passed };
}

// Store Resume Combined Validation Tests
function testStoreResumeValidation(): TestSuite {
  const results: TestResult[] = [];

  results.push(runTest('Valid store resume data accepted', () => 
    validateStoreResume({
      resume: 'A'.repeat(100),
      linkedin: 'LinkedIn profile text',
      jobDescription: 'Job description text',
    }).valid === true
  ));

  results.push(runTest('Optional fields null accepted', () => 
    validateStoreResume({
      resume: 'A'.repeat(100),
      linkedin: null,
      jobDescription: null,
    }).valid === true
  ));

  results.push(runTest('LinkedIn over 50000 chars rejected', () => 
    validateStoreResume({
      resume: 'A'.repeat(100),
      linkedin: 'A'.repeat(50001),
      jobDescription: null,
    }).valid === false
  ));

  results.push(runTest('Job description over 50000 chars rejected', () => 
    validateStoreResume({
      resume: 'A'.repeat(100),
      linkedin: null,
      jobDescription: 'A'.repeat(50001),
    }).valid === false
  ));

  const passed = results.filter(r => r.passed).length;
  return { name: 'Store Resume Validation', results, passed, failed: results.length - passed };
}

// Save Lead Validation Tests
function testSaveLeadValidation(): TestSuite {
  const results: TestResult[] = [];

  results.push(runTest('Valid lead data accepted', () => 
    validateSaveLead({
      email: 'test@example.com',
      industry: 'Technology',
      atsScore: 85,
    }).valid === true
  ));

  results.push(runTest('Optional fields null accepted', () => 
    validateSaveLead({
      email: 'test@example.com',
      industry: null,
      atsScore: null,
    }).valid === true
  ));

  results.push(runTest('ATS score 0 accepted', () => 
    validateSaveLead({
      email: 'test@example.com',
      atsScore: 0,
    }).valid === true
  ));

  results.push(runTest('ATS score 100 accepted', () => 
    validateSaveLead({
      email: 'test@example.com',
      atsScore: 100,
    }).valid === true
  ));

  results.push(runTest('ATS score -1 rejected', () => 
    validateSaveLead({
      email: 'test@example.com',
      atsScore: -1,
    }).valid === false
  ));

  results.push(runTest('ATS score 101 rejected', () => 
    validateSaveLead({
      email: 'test@example.com',
      atsScore: 101,
    }).valid === false
  ));

  results.push(runTest('Industry over 100 chars rejected', () => 
    validateSaveLead({
      email: 'test@example.com',
      industry: 'A'.repeat(101),
    }).valid === false
  ));

  results.push(runTest('Invalid email in lead rejected', () => 
    validateSaveLead({
      email: 'not-an-email',
      industry: 'Tech',
    }).valid === false
  ));

  const passed = results.filter(r => r.passed).length;
  return { name: 'Save Lead Validation', results, passed, failed: results.length - passed };
}

// Injection Attack Tests
function testInjectionPrevention(): TestSuite {
  const results: TestResult[] = [];

  const sqlInjectionPayloads = [
    "'; DROP TABLE users; --",
    "1' OR '1'='1",
    "1; DELETE FROM users",
    "' UNION SELECT * FROM users --",
    "admin'--",
  ];

  const xssPayloads = [
    '<script>alert("XSS")</script>',
    '<img src=x onerror=alert(1)>',
    'javascript:alert(1)',
    '<svg onload=alert(1)>',
    '"><script>alert(1)</script>',
  ];

  // SQL injection in UUID
  sqlInjectionPayloads.forEach((payload, i) => {
    results.push(runTest(`SQL injection ${i + 1} in UUID rejected`, () => 
      validateUUID(payload).valid === false
    ));
  });

  // XSS in UUID
  xssPayloads.forEach((payload, i) => {
    results.push(runTest(`XSS payload ${i + 1} in UUID rejected`, () => 
      validateUUID(payload).valid === false
    ));
  });

  // SQL injection in email
  sqlInjectionPayloads.forEach((payload, i) => {
    results.push(runTest(`SQL injection ${i + 1} in email rejected`, () => 
      validateEmail(payload + '@example.com').valid === false
    ));
  });

  const passed = results.filter(r => r.passed).length;
  return { name: 'Injection Prevention', results, passed, failed: results.length - passed };
}

// Run all security tests
export function runSecurityTests(): { suites: TestSuite[]; totalPassed: number; totalFailed: number } {
  const suites = [
    testUUIDValidation(),
    testEmailValidation(),
    testResumeValidation(),
    testStoreResumeValidation(),
    testSaveLeadValidation(),
    testInjectionPrevention(),
  ];

  const totalPassed = suites.reduce((acc, s) => acc + s.passed, 0);
  const totalFailed = suites.reduce((acc, s) => acc + s.failed, 0);

  // Log results
  console.group('🔒 Security Validation Test Results');
  suites.forEach(suite => {
    const status = suite.failed === 0 ? '✅' : '❌';
    console.group(`${status} ${suite.name} (${suite.passed}/${suite.results.length})`);
    suite.results.forEach(result => {
      if (!result.passed) {
        console.error(`  ❌ ${result.name}`, result.error || '');
      } else if (import.meta.env.DEV) {
        console.log(`  ✅ ${result.name}`);
      }
    });
    console.groupEnd();
  });
  console.log(`\n📊 Total: ${totalPassed}/${totalPassed + totalFailed} tests passed`);
  if (totalFailed > 0) {
    console.error(`⚠️  ${totalFailed} security tests FAILED!`);
  } else {
    console.log('✅ All security tests passed!');
  }
  console.groupEnd();

  return { suites, totalPassed, totalFailed };
}

// Auto-run in development
if (import.meta.env.DEV) {
  // Delay to not block initial render
  setTimeout(() => {
    console.log('🔐 Running security validation tests...');
    runSecurityTests();
  }, 2000);
}
