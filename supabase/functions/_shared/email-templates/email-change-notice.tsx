/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'
import { container, footer, h1, main, text } from './auth-parts.tsx'
import { authMailLanguage, authStrings } from './auth-strings.ts'

/**
 * THE OTHER ADDRESS HEARS ABOUT AN EMAIL CHANGE, WITH NOTHING TO CLICK.
 *
 * GoTrue's email_change payload carries one token for one address. The
 * confirmation goes to that address (EmailChangeEmail); the other one, old or
 * new, gets this notice so a change is never silent to either side. It has no
 * link and no button on purpose: it confirms nothing, and a mail that only
 * informs cannot be used to take an action on the account.
 */
interface EmailChangeNoticeEmailProps {
  siteName: string
  oldEmail: string
  newEmail: string
  /** The address the confirmation link is for, masked unless it is this recipient's own. */
  confirmedAt: string
  /** The reader's language (auth-strings.ts); English by default. */
  lng?: string | null
}

export const EmailChangeNoticeEmail = ({
  siteName,
  oldEmail,
  newEmail,
  confirmedAt,
  lng,
}: EmailChangeNoticeEmailProps) => {
  const s = authStrings(lng)
  return (
    <Html lang={authMailLanguage(lng)} dir="ltr">
      <Head />
      <Preview>{s.notice.preview(siteName)}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{s.notice.heading}</Heading>
          <Text style={text}>
            {s.notice.body(siteName, oldEmail || s.notice.itsAddress, newEmail || s.notice.newAddress, confirmedAt)}
          </Text>
          <Text style={text}>{s.notice.ifYou}</Text>
          <Text style={footer}>{s.notice.why}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export default EmailChangeNoticeEmail
