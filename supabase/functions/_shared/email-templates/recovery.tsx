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

interface RecoveryEmailProps extends CodeProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
  token,
  expiryMinutes,
}: RecoveryEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Reset your password for {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Reset your password</Heading>
        <Text style={text}>
          Someone asked to reset the password for your {siteName} account.
        </Text>
        <CodeBlock token={token} expiryMinutes={expiryMinutes} lead="Enter this code on the reset page to choose a new password:" />
        <Text style={text}>{token ? 'Or continue in your browser:' : 'Press the button to choose a new password:'}</Text>
        <Button style={button} href={confirmationUrl}>
          Choose a new password
        </Button>
        <Text style={footer}>
          {IGNORE_LINE} Your password stays as it is.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default RecoveryEmail
