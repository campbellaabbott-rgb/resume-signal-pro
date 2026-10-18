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

interface MagicLinkEmailProps extends CodeProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({
  siteName,
  confirmationUrl,
  token,
  expiryMinutes,
  lng,
}: MagicLinkEmailProps) => {
  const s = authStrings(lng)
  return (
    <Html lang={authMailLanguage(lng)} dir="ltr">
      <Head />
      <Preview>{s.magic.preview(siteName)}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{s.magic.heading}</Heading>
          <CodeBlock token={token} expiryMinutes={expiryMinutes} lng={lng} lead={s.magic.lead(siteName)} />
          <Text style={text}>{token ? s.magic.orBrowser : s.magic.noToken(siteName)}</Text>
          <Button style={button} href={confirmationUrl}>
            {s.magic.button}
          </Button>
          <Text style={footer}>{s.ignore}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export default MagicLinkEmail
