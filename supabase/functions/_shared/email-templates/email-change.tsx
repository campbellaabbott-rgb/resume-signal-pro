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
import { CodeBlock, button, container, footer, h1, main, text, type CodeProps } from './auth-parts.tsx'
import { authMailLanguage, authStrings } from './auth-strings.ts'

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
  lng,
}: EmailChangeEmailProps) => {
  const s = authStrings(lng)
  return (
    <Html lang={authMailLanguage(lng)} dir="ltr">
      <Head />
      <Preview>{s.change.preview(siteName)}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{s.change.heading}</Heading>
          <Text style={text}>
            {s.change.body(siteName, oldEmail || s.change.currentAddress, newEmail || s.change.newAddress)}
          </Text>
          <CodeBlock token={token} expiryMinutes={expiryMinutes} lng={lng} lead={s.change.lead} />
          <Text style={text}>{token ? s.change.orBrowser : s.change.noToken}</Text>
          <Button style={button} href={confirmationUrl}>
            {s.change.button}
          </Button>
          <Text style={footer}>
            {s.ignore} {s.change.worried}
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export default EmailChangeEmail
