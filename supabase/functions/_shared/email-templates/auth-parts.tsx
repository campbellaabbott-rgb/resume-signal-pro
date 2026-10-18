/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import { Section, Text } from 'npm:@react-email/components@0.0.22'
import { authStrings } from './auth-strings.ts'

/**
 * THE CODE IS IN THE MAIL, ABOVE THE BUTTON (register CP-010).
 *
 * Every auth mail used to carry only a one-time link. A mail scanner that
 * fetches links spends it before the person clicks, and a link cannot finish a
 * sign-in inside a connector pop-up. The code GoTrue issued with the same mail
 * (payload.data.token) works anywhere the sign-in page is open, so each
 * template prints it first, with how long it lasts. The button links to our
 * own confirm page, which signs in only when the person presses Continue.
 */

export const DEFAULT_EXPIRY_MINUTES = 15

export interface CodeProps {
  /** The one-time code (digits only), or null when the payload carried none. */
  token?: string | null
  expiryMinutes?: number
  /** The reader's language, from the link the page asked for (auth-strings.ts); English by default. */
  lng?: string | null
}

export const CodeBlock = ({ token, expiryMinutes, lead, lng }: CodeProps & { lead: string }) =>
  token ? (
    <Section>
      <Text style={codeLead}>{lead}</Text>
      <Text style={codeStyle}>{token}</Text>
      <Text style={codeExpiry}>
        {authStrings(lng).expires(expiryMinutes ?? DEFAULT_EXPIRY_MINUTES)}
      </Text>
    </Section>
  ) : null

export const IGNORE_LINE = authStrings('en').ignore

export const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
export const container = { padding: '20px 25px' }
export const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#000000',
  margin: '0 0 20px',
}
export const text = {
  fontSize: '14px',
  color: '#55575d',
  lineHeight: '1.5',
  margin: '0 0 25px',
}
export const link = { color: 'inherit', textDecoration: 'underline' }
export const button = {
  backgroundColor: '#000000',
  color: '#ffffff',
  fontSize: '14px',
  borderRadius: '8px',
  padding: '12px 20px',
  textDecoration: 'none',
}
export const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0' }
const codeLead = { fontSize: '14px', color: '#55575d', lineHeight: '1.5', margin: '0 0 8px' }
const codeStyle = {
  fontFamily: 'Courier, monospace',
  fontSize: '30px',
  letterSpacing: '6px',
  fontWeight: 'bold' as const,
  color: '#000000',
  margin: '0 0 8px',
}
const codeExpiry = { fontSize: '13px', color: '#55575d', margin: '0 0 25px' }
