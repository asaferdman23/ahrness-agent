import type { BrowserElement } from './client.js'

const USERNAME_LABEL_PATTERN = /email|username|user name|phone|login|account/i
const SUBMIT_LABEL_PATTERN = /log\s?in|sign\s?in|submit|continue/i
const SUBMIT_EXCLUDE_PATTERN = /forgot|help|create|sign\s?up|register/i

export interface LoginFormFields {
  usernameIndex: number | null
  passwordIndex: number | null
  submitIndex: number | null
}

/**
 * Pure heuristic over the same numbered element list browser_view_elements
 * already builds — no raw DOM/CSS-selector guessing needed, since Plan A's
 * auto-indexing already gives every visible input/button a tag/type/label.
 */
export function findLoginFormFields(elements: BrowserElement[]): LoginFormFields {
  const password = elements.find((el) => el.tag === 'input' && el.type === 'password')

  const username = elements.find(
    (el) =>
      el.tag === 'input' &&
      el.type !== 'password' &&
      (el.type === 'email' || el.type === 'text' || el.type === 'tel' || USERNAME_LABEL_PATTERN.test(el.label)),
  )

  const submit = elements.find(
    (el) =>
      (el.tag === 'button' || (el.tag === 'input' && el.type === 'submit')) &&
      SUBMIT_LABEL_PATTERN.test(el.label) &&
      !SUBMIT_EXCLUDE_PATTERN.test(el.label),
  )

  return {
    usernameIndex: username?.index ?? null,
    passwordIndex: password?.index ?? null,
    submitIndex: submit?.index ?? null,
  }
}
