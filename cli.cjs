#!/usr/bin/env node
const fs = require('fs')

const minimisted = require('minimisted')

const git = require('.')

const http = require('./http/node')

const Arweave = require('arweave/node')
const { assert } = require('console')
const { registerPrompt } = require('inquirer')
const { readJsonConfigFile } = require('typescript')
const arweave = Arweave.init({
  host: 'arweave.net',
  port: 443,
  protocol: 'https',
})

const arweaveWalletPath = process.env.ARWEAVE_WALLET_PATH
const rawdata = fs.readFileSync(arweaveWalletPath)
const wallet = JSON.parse(rawdata)
const COMMAND_LIST = [
  'status',
  'init',
  'log',
  'add',
  'commit',
  'config',
  'push',
  'remote',
  'clone',
]

// This really isn't much of a CLI. It's mostly for testing.
// But it's very versatile and works surprisingly well.
function generateArgs(command, args, opts) {
  // console.log(command)
  let resCommand = command
  let result = { filepath: '.', dir: '.' }
  // console.log(command === 'add')
  if (
    command === 'status' ||
    command === 'add' ||
    command === 'init' ||
    command === 'log'
  ) {
    // console.log(args.length)
    if (args.length > 0) {
      //handle directory add to stage

      // console.log('returning shit')
      result.filepath = args[0]
    } else {
      // console.log('Enter filepath')
    }
  } else if (command === 'commit') {
    if ('m' in opts) {
      assert(typeof opts['m'], 'string')
      result.message = opts['m']
    }
  } else if (command === 'clone') {
    resCommand = 'cloneFromArweave'

    if (args.length >= 1) {
      result.url = args[0]
    }

    if (args.length == 2) {
      result.dir = args[1]
    }
  } else if (command == 'config') {
    if (args.length > 1) {
      resCommand = 'setConfig'
      if (args[0] == 'user.name') {
        result.path = 'user.name'
        result.value = args[1]
      } else if (args[0] == 'user.email') {
        result.path = 'user.email'
        result.value = args[1]
      } else {
        process.stderr.write(
          'Available Config `user.name` , `user.email' + '\n'
        )
        process.exit(1)
      }
    }
  } else if (command == 'push') {
    // console.log(args.length)
    assert(args.length == 2)
    resCommand = 'pushToArweave'
    result.remote = args[0]
    result.ref = args[1]
  } else if (command == 'remote') {
    if (args[0] == 'add') {
      resCommand = 'addRemote'
      result.remote = args[1]
      result.url = args[2]
    }
  } else {
    process.stderr.write('Command Not Supported' + '\n')
    process.exit(1)
  }
  // console.log(resCommand, result)
  return { newCommand: resCommand, genOpts: result }
}

minimisted(async function({ _: [command, ...args], ...opts }) {
  if (COMMAND_LIST.includes(command)) {
    const { newCommand, genOpts } = generateArgs(command, args, opts)
    try {
      const result = await git[newCommand](
        Object.assign(
          {
            fs,
            http,
            dir: '.',
            onAuth: () => ({
              username: opts.username,
              password: opts.password,
            }),
            headers: {
              'User-Agent': `git/isogit-${git.version()}`,
            },
            arweave,
            wallet,
          },
          genOpts
        )
      )
      if (result === undefined) return
      // detect streams
      if (typeof result.on === 'function') {
        result.pipe(process.stdout)
      } else {
        console.log(JSON.stringify(result, null, 2))
      }
    } catch (err) {
      process.stderr.write(err.message + '\n')
      console.log(err)
      process.exit(1)
    }
  } else {
    process.stderr.write('Command Not supported' + '\n')
    process.exit(1)
  }
})
