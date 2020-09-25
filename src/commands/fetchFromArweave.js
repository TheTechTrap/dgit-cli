// @ts-check
import '../typedefs.js'

import { _currentBranch } from '../commands/currentBranch.js'
import { MissingParameterError } from '../errors/MissingParameterError.js'
import { RemoteCapabilityError } from '../errors/RemoteCapabilityError.js'
import { GitConfigManager } from '../managers/GitConfigManager.js'
import { GitRefManager } from '../managers/GitRefManager.js'
import { GitRemoteManager } from '../managers/GitRemoteManager.js'
import { GitShallowManager } from '../managers/GitShallowManager.js'
import { GitCommit } from '../models/GitCommit.js'
import { GitPackIndex } from '../models/GitPackIndex.js'
import { hasObject } from '../storage/hasObject.js'
import { _readObject as readObject } from '../storage/readObject.js'
import { abbreviateRef } from '../utils/abbreviateRef.js'
import { collect } from '../utils/collect.js'
import { emptyPackfile } from '../utils/emptyPackfile.js'
import { filterCapabilities } from '../utils/filterCapabilities.js'
import { forAwait } from '../utils/forAwait.js'
import { join } from '../utils/join.js'
import { pkg } from '../utils/pkg.js'
import { splitLines } from '../utils/splitLines.js'
import { parseUploadPackResponse } from '../wire/parseUploadPackResponse.js'
import { writeUploadPackRequest } from '../wire/writeUploadPackRequest.js'
import { getRefsOnArweave, fetchGitObjects } from '../utils/arweave.js'

/**
 *
 * @typedef {object} FetchResult - The object returned has the following schema:
 * @property {string | null} defaultBranch - The branch that is cloned if no branch is specified
 * @property {string | null} fetchHead - The SHA-1 object id of the fetched head commit
 * @property {string | null} fetchHeadDescription - a textual description of the branch that was fetched
 * @property {Object<string, string>} [headers] - The HTTP response headers returned by the git server
 * @property {string[]} [pruned] - A list of branches that were pruned, if you provided the `prune` parameter
 *
 */

/**
 * @param {object} args
 * @param {import('../models/FileSystem.js').FileSystem} args.fs
 * @param {import { fetch } from '../../index.d';
HttpClient} args.http
 * @param {ProgressCallback} [args.onProgress]
 * @param {MessageCallback} [args.onMessage]
 * @param {AuthCallback} [args.onAuth]
 * @param {AuthFailureCallback} [args.onAuthFailure]
 * @param {AuthSuccessCallback} [args.onAuthSuccess]
 * @param {string} args.gitdir
 * @param {string|void} [args.url]
 * @param {string} [args.corsProxy]
 * @param {string} [args.ref]
 * @param {string} [args.remoteRef]
 * @param {string} [args.remote]
 * @param {boolean} [args.singleBranch = false]
 * @param {boolean} [args.tags = false]
 * @param {number} [args.depth]
 * @param {Date} [args.since]
 * @param {string[]} [args.exclude = []]
 * @param {boolean} [args.relative = false]
 * @param {Object<string, string>} [args.headers]
 * @param {boolean} [args.prune]
 * @param {boolean} [args.pruneTags]
 * @param {Arweave} [args.arweave]
 *
 * @returns {Promise<FetchResult>}
 * @see FetchResult
 */
export async function _fetchFromArweave({
  fs,
  http,
  onProgress,
  onMessage,
  onAuth,
  onAuthSuccess,
  onAuthFailure,
  gitdir,
  ref: _ref,
  remoteRef: _remoteRef,
  remote: _remote,
  url: _url,
  corsProxy,
  depth = null,
  since = null,
  exclude = [],
  relative = false,
  tags = false,
  singleBranch = false,
  headers = {},
  prune = false,
  pruneTags = false,
  arweave,
}) {
  const ref = _ref || (await _currentBranch({ fs, gitdir, test: true }))
  const config = await GitConfigManager.get({ fs, gitdir })
  // Figure out what remote to use.
  const remote =
    _remote || (ref && (await config.get(`branch.${ref}.remote`))) || 'origin'
  // Lookup the URL for the given remote.
  const url = _url || (await config.get(`remote.${remote}.url`))
  if (typeof url === 'undefined') {
    throw new MissingParameterError('remote OR url')
  }
  // Figure out what remote ref to use.
  const remoteRef =
    _remoteRef ||
    (ref && (await config.get(`branch.${ref}.merge`))) ||
    _ref ||
    'master'

  if (corsProxy === undefined) {
    corsProxy = await config.get('http.corsProxy')
  }

  const remoteRefs = await getRefsOnArweave(arweave, url)
  // For the special case of an empty repository with no refs, return null.
  if (remoteRefs.size === 0) {
    return {
      defaultBranch: null,
      fetchHead: null,
      fetchHeadDescription: null,
    }
  }

  // Figure out the SHA for the requested ref
  const { oid, fullref } = GitRefManager.resolveAgainstMap({
    ref: remoteRef,
    map: remoteRefs,
  })

  const symrefs = new Map()
  await GitRefManager.updateRemoteRefs({
    fs,
    gitdir,
    remote,
    refs: remoteRefs,
    symrefs,
    tags,
    prune,
  })

  const objects = await fetchGitObjects(arweave, url)

  // Write objects
  await Promise.all(
    objects.map(async object => {
      const subdirectory = object.oid.substring(0, 2)
      const filename = object.oid.substring(2)
      const objectPath = `objects/${subdirectory}/${filename}`
      const fullpath = join(gitdir, objectPath)
      const buf = Buffer.from(object.data)
      await fs.write(fullpath, buf)
    })
  )

  const noun = fullref.startsWith('refs/tags') ? 'tag' : 'branch'
  return {
    defaultBranch: fullref,
    fetchHead: oid,
    fetchHeadDescription: `${noun} '${abbreviateRef(fullref)}' of ${url}`,
  }
}
