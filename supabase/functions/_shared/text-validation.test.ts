import { describe, it, expect } from "vitest";
import { looksGarbled, isOleCompoundFile } from "./text-validation";

describe("looksGarbled", () => {
  it("does not flag a normal English resume", () => {
    const text = `Jane Doe
jane@example.com | (555) 123-4567

Summary
Senior engineer with 8 years of experience building scalable systems.

Experience
Senior Software Engineer, Acme Corp
Jan 2020 - Present
- Led a team of 5 engineers shipping features used by millions of users.
- Reduced infrastructure costs by 30% through migration to serverless.

Education
B.S. Computer Science, State University`;
    expect(looksGarbled(text)).toBe(false);
  });

  it("does not flag a non-English (Hindi) resume", () => {
    const text = `जेन डो
jane@example.com | (555) 123-4567

सारांश
8 वर्षों के अनुभव के साथ वरिष्ठ इंजीनियर।

अनुभव
वरिष्ठ सॉफ्टवेयर इंजीनियर, एक्मे कॉर्प
जनवरी 2020 - वर्तमान
- 5 इंजीनियरों की टीम का नेतृत्व किया।

शिक्षा
कंप्यूटर विज्ञान में स्नातक`;
    expect(looksGarbled(text)).toBe(false);
  });

  it("does not flag dense text as long as it has normal punctuation/line breaks", () => {
    // Guards against the whitespace-ratio backstop being too aggressive on
    // legitimately dense formatting (e.g. comma/semicolon-separated skill lists).
    const text = "Skills: JavaScript,TypeScript,React,Node.js,PostgreSQL,Docker,Kubernetes,AWS,GraphQL,Redis,Python,Go,Rust,SQL,NoSQL,CI/CD,Terraform,Microservices,REST,gRPC.\nCertifications: AWS Solutions Architect, CKA, PMP.\nLanguages: English, Spanish, French.";
    expect(looksGarbled(text)).toBe(false);
  });

  it("flags text with a high ratio of replacement characters (broken font encoding)", () => {
    const text = "���� ��gineer �ith �x�erience �n �o�t�are �e�elop�ent ��� �roje�t �ana�e�ent ��� �eam �ea�ership ��� ��ile �etho�olo�ies".repeat(2);
    expect(looksGarbled(text)).toBe(true);
  });

  it("flags text with raw control characters", () => {
    const base = "Experience Software Engineer at Acme Corp building scalable distributed systems with a team of five engineers ";
    const text = (base + "\x01\x02\x03\x04\x05").repeat(3);
    expect(looksGarbled(text)).toBe(true);
  });

  it("flags a wall of glued-together text with almost no whitespace", () => {
    const text = "a".repeat(500) + "b".repeat(500); // no whitespace at all, well over the length floor
    expect(looksGarbled(text)).toBe(true);
  });

  it("does not judge text under the length floor either way", () => {
    expect(looksGarbled("short")).toBe(false);
    expect(looksGarbled("")).toBe(false);
  });
});

describe("isOleCompoundFile", () => {
  it("detects the OLE Compound File signature (legacy .doc / encrypted .docx)", () => {
    const buf = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).buffer;
    expect(isOleCompoundFile(buf)).toBe(true);
  });

  it("does not flag a real .docx (ZIP signature, starts with PK)", () => {
    const buf = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]).buffer;
    expect(isOleCompoundFile(buf)).toBe(false);
  });

  it("does not flag a real PDF (starts with %PDF)", () => {
    const buf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]).buffer;
    expect(isOleCompoundFile(buf)).toBe(false);
  });

  it("does not throw on a buffer shorter than 4 bytes", () => {
    const buf = new Uint8Array([0xd0, 0xcf]).buffer;
    expect(() => isOleCompoundFile(buf)).not.toThrow();
    expect(isOleCompoundFile(buf)).toBe(false);
  });
});
