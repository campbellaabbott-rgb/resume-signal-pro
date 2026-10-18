/**
 * THE FAQ NAMES THE TRADER AND PROMISES ONLY WHAT IS TRUE (plan CP-G and
 * S12-049; account-compliance's handoff to checkout-catalogue, applied at
 * integration).
 *
 * WHAT WAS WRONG. en-GB called the trader "CV Booster" in the FAQ's subtitle
 * and its first question, a name no receipt, notice or legal page carries.
 * And "Why is this better than ChatGPT?" promised "LinkedIn analysis", which
 * is no longer offered, and that a résumé is "never used for training", which
 * the AI providers' terms behind the gateway were never checked to support.
 *
 * NOW the subtitle and the first question insert TRADING_NAME (never
 * translated), and the ChatGPT answer reads a new key that says what we do:
 * we train no AI model on a résumé, and the free scan deletes it within 7
 * days. Mounted for real, in English; the translator's en-GB values for these
 * keys are held to the trading name in the locale test.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FAQ, FAQ_REWORDED } from "@/components/FAQ";
import { TRADING_NAME } from "@/config/seller";

afterEach(cleanup);

const answerTo = (question: RegExp): string => {
  render(<FAQ />);
  fireEvent.click(screen.getByRole("button", { name: question }));
  return document.querySelector("[data-state='open'][role='region']")?.textContent ?? "";
};

describe("the FAQ", () => {
  it("names the trader in its subtitle and its first question", () => {
    render(<FAQ />);
    expect(screen.getByText(`Everything you need to know about ${TRADING_NAME}`)).toBeTruthy();
    expect(screen.getByRole("button", { name: `What do I get with ${TRADING_NAME}?` })).toBeTruthy();
  });

  it("the ChatGPT answer offers no LinkedIn analysis and claims no training promise it cannot keep", () => {
    const answer = answerTo(/better than ChatGPT/);
    expect(answer).not.toMatch(/LinkedIn/i);
    expect(answer).not.toMatch(/never used for training/i);
    expect(answer).toMatch(/We do not train AI models on your résumé/);
    expect(answer).toMatch(/free scan deletes it within 7 days/);
    expect(answer).toContain(TRADING_NAME);
  });

  it("the moved halves read new keys, and the halves that did not move keep theirs", () => {
    expect(FAQ_REWORDED.whatDoIGet.question?.[0]).toBe("faq.questions.whatDoIGetNamed.question");
    expect(FAQ_REWORDED.whatDoIGet.answer).toBeUndefined();
    expect(FAQ_REWORDED.vsChatGPT.answer?.[0]).toBe("faq.questions.vsChatGPTTrue.answer");
  });
});
