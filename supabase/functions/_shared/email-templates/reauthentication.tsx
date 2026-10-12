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
import { CodeBlock, container, footer, h1, main, type CodeProps } from './auth-parts.tsx'
import { authMailLanguage, authStrings } from './auth-strings.ts'

type ReauthenticationEmailProps = CodeProps

export const ReauthenticationEmail = ({ token, expiryMinutes, lng }: ReauthenticationEmailProps) => {
  const s = authStrings(lng)
  return (
    <Html lang={authMailLanguage(lng)} dir="ltr">
      <Head />
      <Preview>{s.reauth.preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{s.reauth.heading}</Heading>
          <CodeBlock token={token} expiryMinutes={expiryMinutes} lng={lng} lead={s.reauth.lead} />
          <Text style={footer}>{s.ignore}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export default ReauthenticationEmail
