// Unit tests for docket's config file: defaults, migration, the user/project merge and the file's form.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { CONFIG_VERSION, FIELDS, defaults, merged, migrate, parse, serialize } from '../hooks/config.ts'

describe('defaults', () => {
  test('hold every field at its default, with the version', () => {
    const config = defaults()
    assert.equal(config.version, CONFIG_VERSION)
    for (const [key, field] of Object.entries(FIELDS)) assert.equal(config[key], field.default)
  })
})

describe('migrate', () => {
  test('fills missing keys at their defaults and keeps what was set', () => {
    const { config, from, added, isChanged } = migrate({ leanColor: '#123456' })
    assert.equal(from, 0)
    assert.equal(config.version, CONFIG_VERSION)
    assert.equal(config.leanColor, '#123456')
    assert.equal(config.questionsCap, 7)
    assert.ok(added.includes('questionsCap') && !added.includes('leanColor'))
    assert.ok(isChanged)
  })

  test('leaves a complete, current config unchanged', () => {
    const { isChanged, added } = migrate(defaults())
    assert.ok(!isChanged)
    assert.deepEqual(added, [])
  })

  test("keeps keys it doesn't know, and starts over from a file that isn't an object", () => {
    assert.equal(migrate({ ...defaults(), future: 'kept' }).config.future, 'kept')
    assert.equal(migrate([1, 2]).config.version, CONFIG_VERSION)
  })
})

describe('merged', () => {
  test('lets the project win over the user, and both over the defaults', () => {
    const user = { ...defaults(), leanColor: '#111111', itemColor: '#222222' }
    const project = { ...defaults(), leanColor: '#333333' }
    const options = merged(user, project)
    assert.equal(options.leanColor, '#333333')
    assert.equal(options.itemColor, defaults().itemColor)
    assert.equal(merged(user).itemColor, '#222222')
    assert.equal(merged().questionsCap, 7)
  })
})

describe('serialize and parse', () => {
  test('write the version first and read back what they wrote', () => {
    const text = serialize({ ...defaults(), extra: true })
    assert.match(text, /^\{\n  "version": /)
    assert.deepEqual(parse(text), { ...defaults(), extra: true })
  })

  test('read a broken or missing file as missing', () => {
    assert.equal(parse('{ not json'), undefined)
    assert.equal(parse(undefined), undefined)
  })
})

describe('a project file', () => {
  test('is raised in version but never filled in, so it overrides only what it says', () => {
    const migration = migrate({ version: 1, display: 'band' }, true)
    assert.deepEqual(migration.config, { version: CONFIG_VERSION, display: 'band' })
    assert.deepEqual(migration.added, [])
    assert.equal(merged({ ...defaults(), language: 'es' }, migration.config).language, 'es')
    assert.equal(merged({ ...defaults(), language: 'es' }, migration.config).display, 'band')
  })
})
