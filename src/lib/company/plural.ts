/**
 * ONE PLURAL STRING PER COUNT, NEVER FRAGMENTS.
 *
 * "Filled 1 roles in 34d" and the Hindi "भरे गए 452 88 दिनों..." came from a
 * sentence assembled out of a prefix key, a bare number and a suffix key
 * (audit CP22). Every counted sentence on the company page is one key with
 * i18next plural forms (_one / _other, plus _many where Intl.PluralRules
 * reports it: es, fr, pt), chosen by `count`, with the display figure passed
 * separately as an already formatted string.
 *
 * The English forms ride along as defaults so the page reads in English
 * before the company shard is merged, and a test holds each default equal to
 * the shard's English value.
 */
import i18n, { type TFunction } from "i18next";

type AnyT = TFunction | ((key: string, opts?: Record<string, unknown>) => string);

export function tPlural(
  t: AnyT | null,
  key: string,
  count: number,
  vars: Record<string, unknown>,
  one: string,
  other: string,
): string {
  const fn = (t ?? i18n.t.bind(i18n)) as (key: string, opts: Record<string, unknown>) => string;
  return fn(key, { ...vars, count, defaultValue_one: one, defaultValue_other: other });
}
