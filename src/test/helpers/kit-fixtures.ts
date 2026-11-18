/**
 * A résumé and the apply kit a model would hand back for it, for tests that
 * run generate-apply-package with only its network faked.
 */
export const KIT_RESUME = [
  "Jane Doe | jane.doe@example.com",
  "Senior software engineer, Initech, 2018 - 2024",
  "- Led the payments team of five engineers on TypeScript and Postgres services",
  "- Cut checkout latency by 40% with a caching layer",
  "Software engineer, Globex Corporation, 2014 - 2018",
  "- Built billing integrations in TypeScript",
  "Skills: TypeScript, Postgres, Payments",
].join("\n");

export const KIT_POSTING = "Hooli is hiring a senior engineer to own checkout and payments services end to end. TypeScript and Postgres required.";

/** A kit every fact of which is on KIT_RESUME; `over` replaces parts of its résumé. */
export function groundedKit(over: Record<string, unknown> = {}) {
  return {
    jobMetadata: { company: "Hooli", roleTitle: "Senior Engineer", applyMethodHint: "" },
    tailoredResume: {
      contact: { fullName: "Jane Doe", title: "Senior software engineer", email: "jane.doe@example.com", phone: "", location: "", linkedIn: "", website: "" },
      summary: "Senior software engineer who led a payments team.",
      experience: [
        { company: "Initech", title: "Senior software engineer", location: "", startDate: "2018", endDate: "2024", bullets: ["Led the payments team of five engineers", "Cut checkout latency by 40% with a caching layer"] },
      ],
      education: [],
      skills: ["TypeScript", "Postgres"],
      certifications: [],
      ...over,
    },
    skillGaps: [],
    checklist: ["Review the résumé", "Apply on the employer's site"],
  };
}

/** The same kit with a year on Initech the résumé never states (a grounding refusal). */
export function inventedYearKit() {
  return groundedKit({
    experience: [{ company: "Initech", title: "Senior software engineer", location: "", startDate: "2011", endDate: "2024", bullets: ["Led the payments team"] }],
  });
}

/** A gateway 200 whose tool call carries these arguments. */
export const kitReply = (args: unknown) =>
  new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { tool_calls: [{ function: { name: "submit_apply_package", arguments: typeof args === "string" ? args : JSON.stringify(args) } }] } }] }), { status: 200 });
