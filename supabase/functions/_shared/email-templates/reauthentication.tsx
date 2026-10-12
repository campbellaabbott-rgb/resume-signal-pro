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
import { CodeBlock, IGNORE_LINE, container, footer, h1, main, type CodeProps } from './auth-parts.tsx'

type ReauthenticationEmailProps = CodeProps

export const ReauthenticationEmail = ({ token, expiryMinutes }: ReauthenticationEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your verification code</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Confirm it's you</Heading>
        <CodeBlock token={token} expiryMinutes={expiryMinutes} lead="Use this code to confirm your identity:" />
        <Text style={footer}>{IGNORE_LINE}</Text>
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail
