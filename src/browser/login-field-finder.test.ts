import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findLoginFormFields } from './login-field-finder.js'
import type { BrowserElement } from './client.js'

test('finds username, password, and submit on a typical login form', () => {
  const elements: BrowserElement[] = [
    { index: 0, tag: 'a', type: null, label: 'Learn more' },
    { index: 1, tag: 'input', type: 'email', label: 'Email or phone' },
    { index: 2, tag: 'input', type: 'password', label: 'Password' },
    { index: 3, tag: 'button', type: null, label: 'Log in' },
  ]
  const result = findLoginFormFields(elements)
  assert.equal(result.usernameIndex, 1)
  assert.equal(result.passwordIndex, 2)
  assert.equal(result.submitIndex, 3)
})

test('matches a username field by label text when type is generic text', () => {
  const elements: BrowserElement[] = [
    { index: 0, tag: 'input', type: 'text', label: 'Username' },
    { index: 1, tag: 'input', type: 'password', label: '' },
    { index: 2, tag: 'input', type: 'submit', label: 'Sign in' },
  ]
  const result = findLoginFormFields(elements)
  assert.equal(result.usernameIndex, 0)
  assert.equal(result.passwordIndex, 1)
  assert.equal(result.submitIndex, 2)
})

test('returns nulls for a page with no recognizable login form', () => {
  const elements: BrowserElement[] = [
    { index: 0, tag: 'a', type: null, label: 'Home' },
    { index: 1, tag: 'a', type: null, label: 'About' },
  ]
  const result = findLoginFormFields(elements)
  assert.equal(result.usernameIndex, null)
  assert.equal(result.passwordIndex, null)
  assert.equal(result.submitIndex, null)
})

test('prefers a button/input with login-like label text for submit over an unrelated button', () => {
  const elements: BrowserElement[] = [
    { index: 0, tag: 'input', type: 'email', label: 'Email' },
    { index: 1, tag: 'input', type: 'password', label: 'Password' },
    { index: 2, tag: 'button', type: null, label: 'Forgot password?' },
    { index: 3, tag: 'button', type: null, label: 'Sign in' },
  ]
  const result = findLoginFormFields(elements)
  assert.equal(result.submitIndex, 3)
})

test('excludes a decoy label that matches both the inclusion and exclusion patterns, in favor of the real submit button', () => {
  const elements: BrowserElement[] = [
    { index: 0, tag: 'input', type: 'email', label: 'Email' },
    { index: 1, tag: 'input', type: 'password', label: 'Password' },
    { index: 2, tag: 'button', type: null, label: 'Sign in to create an account' },
    { index: 3, tag: 'button', type: null, label: 'Log in' },
  ]
  const result = findLoginFormFields(elements)
  assert.equal(result.submitIndex, 3, 'the decoy at index 2 matches both patterns and must be excluded in favor of the real submit button')
})
