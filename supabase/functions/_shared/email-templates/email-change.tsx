/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'
import { CodeBlock, IGNORE_LINE, button, container, footer, h1, main, text, type CodeProps } from './auth-parts.tsx'

/**
 * The confirmation for an email change. It goes ONLY to payload.data.email,
 * the address GoTrue issued this token and link for (register CP-009 review:
 * the payload carries one token and one url, so mailing that link to both
 * addresses would hand one address's confirmation to the other). The other
 * address gets EmailChangeNoticeEmail, which carries no link.
 *
 * oldEmail and newEmail arrive already prepared by the hook: an address is
 * shown in full only to the account's current address or to itself, and
 * masked otherwise, so a stranger whose address was typed as the new one does
 * not learn the account holder's address.
 */
interface EmailChangeEmailProps extends CodeProps {
  siteName: string
  oldEmail: string
  email: string
  newEmail: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({
  siteName,
  oldEmail,
  newEmail,
  confirmationUrl,
  token,
  expiryMinutes,
}: EmailChangeEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email change for {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Confirm your email change</Heading>
        <Text style={text}>
          Someone asked to change the email address on your {siteName} account
          from {oldEmail || 'your current address'} to {newEmail || 'a new address'}.
        </Text>
        <CodeBlock token={token} expiryMinutes={expiryMinutes} lead="Enter this code to confirm the change:" />
        <Text style={text}>{token ? 'Or confirm in your browser:' : 'Press the button to confirm the change:'}</Text>
        <Button style={button} href={confirmationUrl}>
          Confirm the change
        </Button>
        <Text style={footer}>
          {IGNORE_LINE} If you think someone else is using your account, reply
          to this mail so a person can secure it.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default EmailChangeEmail
