/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'
import { CodeBlock, button, container, footer, h1, link, main, text, type CodeProps } from './auth-parts.tsx'
import { authMailLanguage, authStrings } from './auth-strings.ts'

interface InviteEmailProps extends CodeProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({
  siteName,
  siteUrl,
  confirmationUrl,
  token,
  expiryMinutes,
  lng,
}: InviteEmailProps) => {
  const s = authStrings(lng)
  return (
    <Html lang={authMailLanguage(lng)} dir="ltr">
      <Head />
      <Preview>{s.invite.preview(siteName)}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{s.invite.heading}</Heading>
          <Text style={text}>
            {s.invite.before}
            <Link href={siteUrl} style={link}>
              <strong>{siteName}</strong>
            </Link>
            {s.invite.after}
          </Text>
          <CodeBlock token={token} expiryMinutes={expiryMinutes} lng={lng} lead={s.invite.lead} />
          <Text style={text}>{token ? s.invite.orBrowser : s.invite.noToken}</Text>
          <Button style={button} href={confirmationUrl}>
            {s.invite.button}
          </Button>
          <Text style={footer}>{s.ignore}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export default InviteEmail
