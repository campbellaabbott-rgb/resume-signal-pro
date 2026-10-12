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

interface MagicLinkEmailProps extends CodeProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({
  siteName,
  confirmationUrl,
  token,
  expiryMinutes,
}: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your sign-in code for {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Your sign-in code</Heading>
        <CodeBlock token={token} expiryMinutes={expiryMinutes} lead={`Enter this code on the ${siteName} sign-in page:`} />
        <Text style={text}>
          {token ? 'Or continue in your browser:' : `Press the button to sign in to ${siteName}. It expires shortly.`}
        </Text>
        <Button style={button} href={confirmationUrl}>
          Continue
        </Button>
        <Text style={footer}>{IGNORE_LINE}</Text>
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail
