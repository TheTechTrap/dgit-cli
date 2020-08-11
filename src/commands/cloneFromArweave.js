// @ts-check
import '../typedefs.js'

import { _addRemote } from '../commands/addRemote.js'
import { _checkout } from '../commands/checkout.js'
import { _fetchFromArweave } from '../commands/fetchFromArweave.js'
import { _init } from '../commands/init.js'
import { GitConfigManager } from '../managers/GitConfigManager.js'
import { parseArgitRemoteURI } from '../utils/arweave'
import {join} from '../utils/join'
/**
 * @param {object} args
 * @param {import('../models/FileSystem.js').FileSystem} args.fs
 * @param {object} args.cache
 * @param {HttpClient} args.http
 * @param {ProgressCallback} [args.onProgress]
 * @param {MessageCallback} [args.onMessage]
 * @param {AuthCallback} [args.onAuth]
 * @param {AuthFailureCallback} [args.onAuthFailure]
 * @param {AuthSuccessCallback} [args.onAuthSuccess]
 * @param {string} [args.dir]
 * @param {string} args.gitdir
 * @param {string} args.url
 * @param {string} args.corsProxy
 * @param {string} args.ref
 * @param {boolean} args.singleBranch
 * @param {boolean} args.noCheckout
 * @param {boolean} args.noTags
 * @param {string} args.remote
 * @param {number} args.depth
 * @param {Date} args.since
 * @param {string[]} args.exclude
 * @param {boolean} args.relative
 * @param {Object<string, string>} args.headers
 * @param {Arweave} args.arweave
 *
 * @returns {Promise<void>} Resolves successfully when clone completes
 *
 */
export async function _cloneFromArweave({
  fs,
  cache,
  http,
  onProgress,
  onMessage,
  onAuth,
  onAuthSuccess,
  onAuthFailure,
  dir,
  gitdir,
  url,
  corsProxy,
  ref,
  remote,
  depth,
  since,
  exclude,
  relative,
  singleBranch,
  noCheckout,
  noTags,
  headers,
  arweave,
}) {
  const { repoName } = parseArgitRemoteURI(url)
  dir = dir || repoName
  gitdir = join(dir,'.git')]
  await _init({ fs, gitdir })
  await _addRemote({ fs, gitdir, remote, url, force: false })
  if (corsProxy) {
    const config = await GitConfigManager.get({ fs, gitdir })
    await config.set(`http.corsProxy`, corsProxy)
    await GitConfigManager.save({ fs, gitdir, config })
  }
  const { defaultBranch, fetchHead } = await _fetchFromArweave({
    fs,
    http,
    onProgress,
    onMessage,
    onAuth,
    onAuthSuccess,
    onAuthFailure,
    gitdir,
    ref,
    remote,
    depth,
    since,
    exclude,
    relative,
    singleBranch,
    headers,
    tags: !noTags,
    arweave,
  })
  if (fetchHead === null) return
  ref = ref || defaultBranch
  ref = ref.replace('refs/heads/', '')
  // Checkout that branch
  await _checkout({
    fs,
    cache,
    onProgress,
    dir,
    gitdir,
    ref,
    remote,
    noCheckout,
  })
}
