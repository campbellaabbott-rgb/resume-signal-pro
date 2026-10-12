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
import { CodeBlock, IGNORE_LINE, button, container, footer, h1, link, main, text, type CodeProps } from './auth-parts.tsx'

interface SignupEmailProps extends CodeProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({
  siteName,
  siteUrl,
  recipient,
  confirmationUrl,
  token,
  expiryMinutes,
}: SignupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email for {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Confirm your email</Heading>
        <Text style={text}>
          Thanks for signing up for{' '}
          <Link href={siteUrl} style={link}>
            <strong>{siteName}</strong>
          </Link>
          . This confirms that {recipient} is your address.
        </Text>
        <CodeBlock token={token} expiryMinutes={expiryMinutes} lead="Enter this code on the sign-in page:" />
        <Text style={text}>{token ? 'Or confirm in your browser:' : 'Press the button to confirm it:'}</Text>
        <Button style={button} href={confirmationUrl}>
          Confirm email
        </Button>
        <Text style={footer}>{IGNORE_LINE}</Text>
      </Container>
    </Body>
  </Html>
)

export default SignupEmail
