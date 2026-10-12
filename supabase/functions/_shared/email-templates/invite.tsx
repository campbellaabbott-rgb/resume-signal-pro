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
}: InviteEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You've been invited to join {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>You've been invited</Heading>
        <Text style={text}>
          You've been invited to join{' '}
          <Link href={siteUrl} style={link}>
            <strong>{siteName}</strong>
          </Link>
          .
        </Text>
        <CodeBlock token={token} expiryMinutes={expiryMinutes} lead="Enter this code on the sign-in page to accept:" />
        <Text style={text}>{token ? 'Or accept in your browser:' : 'Press the button to accept the invitation:'}</Text>
        <Button style={button} href={confirmationUrl}>
          Accept invitation
        </Button>
        <Text style={footer}>{IGNORE_LINE}</Text>
      </Container>
    </Body>
  </Html>
)

export default InviteEmail
