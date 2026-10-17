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
  lng,
}: SignupEmailProps) => {
  const s = authStrings(lng)
  return (
    <Html lang={authMailLanguage(lng)} dir="ltr">
      <Head />
      <Preview>{s.signup.preview(siteName)}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{s.signup.heading}</Heading>
          <Text style={text}>
            {s.signup.before}
            <Link href={siteUrl} style={link}>
              <strong>{siteName}</strong>
            </Link>
            {s.signup.after(recipient)}
          </Text>
          <CodeBlock token={token} expiryMinutes={expiryMinutes} lng={lng} lead={s.signup.lead} />
          <Text style={text}>{token ? s.signup.orBrowser : s.signup.noToken}</Text>
          <Button style={button} href={confirmationUrl}>
            {s.signup.button}
          </Button>
          <Text style={footer}>{s.ignore}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export default SignupEmail
