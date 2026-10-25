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

interface RecoveryEmailProps extends CodeProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
  token,
  expiryMinutes,
  lng,
}: RecoveryEmailProps) => {
  const s = authStrings(lng)
  return (
    <Html lang={authMailLanguage(lng)} dir="ltr">
      <Head />
      <Preview>{s.recovery.preview(siteName)}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{s.recovery.heading}</Heading>
          <Text style={text}>{s.recovery.body(siteName)}</Text>
          <CodeBlock token={token} expiryMinutes={expiryMinutes} lng={lng} lead={s.recovery.lead} />
          <Text style={text}>{token ? s.recovery.orBrowser : s.recovery.noToken}</Text>
          <Button style={button} href={confirmationUrl}>
            {s.recovery.button}
          </Button>
          <Text style={footer}>
            {s.ignore} {s.recovery.stays}
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export default RecoveryEmail
