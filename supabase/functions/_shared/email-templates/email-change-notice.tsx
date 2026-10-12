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
}

export const EmailChangeNoticeEmail = ({
  siteName,
  oldEmail,
  newEmail,
  confirmedAt,
}: EmailChangeNoticeEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>An email change was requested on {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>An email change was requested</Heading>
        <Text style={text}>
          Someone asked to change the email address on a {siteName} account
          from {oldEmail || 'its current address'} to {newEmail || 'a new address'}.
          The link that confirms it goes only to {confirmedAt}. This mail
          confirms nothing.
        </Text>
        <Text style={text}>
          If this was you, there is nothing to do here. If it wasn't, reply to
          this mail straight away so a person can secure the account.
        </Text>
        <Text style={footer}>
          You are getting this because this address is the old or the new
          address on that account.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default EmailChangeNoticeEmail
