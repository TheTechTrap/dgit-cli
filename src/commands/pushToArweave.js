// @ts-check
import '../typedefs.js'

import { _currentBranch } from '../commands/currentBranch.js'
import { _findMergeBase } from '../commands/findMergeBase.js'
import { _isDescendent } from '../commands/isDescendent.js'
import { listCommitsAndTags } from '../commands/listCommitsAndTags.js'
import { listObjects } from '../commands/listObjects.js'
import { _pack } from '../commands/pack.js'
import { GitPushError } from '../errors/GitPushError.js'
import { MissingParameterError } from '../errors/MissingParameterError.js'
import { NotFoundError } from '../errors/NotFoundError.js'
import { PushRejectedError } from '../errors/PushRejectedError.js'
import { GitConfigManager } from '../managers/GitConfigManager.js'
import { GitRefManager } from '../managers/GitRefManager.js'
import { GitRemoteManager } from '../managers/GitRemoteManager.js'
import { GitSideBand } from '../models/GitSideBand.js'
import { filterCapabilities } from '../utils/filterCapabilities.js'
import { forAwait } from '../utils/forAwait.js'
import { pkg } from '../utils/pkg.js'
import { splitLines } from '../utils/splitLines.js'
import { parseReceivePackResponse } from '../wire/parseReceivePackResponse.js'
import { writeReceivePackRequest } from '../wire/writeReceivePackRequest.js'
import { _packObjects } from './packObjects.js'
import Arweave from 'arweave/node'
import {
  getRefsOnArweave,
  getRef,
  pushPackfile,
  updateRef,
} from '../utils/arweave.js'

/**
 * @param {object} args
 * @param {import('../models/FileSystem.js').FileSystem} args.fs
 * @param {import { pushToArweave } from '../../index.d';
HttpClient} args.http
 * @param {ProgressCallback} [args.onProgress]
 * @param {MessageCallback} [args.onMessage]
 * @param {AuthCallback} [args.onAuth]
 * @param {AuthFailureCallback} [args.onAuthFailure]
 * @param {AuthSuccessCallback} [args.onAuthSuccess]
 * @param {string} args.gitdir
 * @param {string} [args.ref]
 * @param {string} [args.remoteRef]
 * @param {string} [args.remote]
 * @param {boolean} [args.force = false]
 * @param {boolean} [args.delete = false]
 * @param {string} [args.url]
 * @param {string} [args.corsProxy]
 * @param {Object<string, string>} [args.headers]
 * @param {Arweave} [args.arweave]
 * @param {ArweaveWallet} [args.wallet]
 *
 * @returns {Promise<PushResult>}
 */
export async function _pushToArweave({
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
  remote,
  url: _url,
  force = false,
  delete: _delete = false,
  corsProxy,
  headers = {},
  arweave,
  wallet,
}) {
  const ref = _ref || (await _currentBranch({ fs, gitdir }))
  if (typeof ref === 'undefined') {
    throw new MissingParameterError('ref')
  }
  const config = await GitConfigManager.get({ fs, gitdir })
  // Figure out what remote to use.
  remote =
    remote ||
    (await config.get(`branch.${ref}.pushRemote`)) ||
    (await config.get('remote.pushDefault')) ||
    (await config.get(`branch.${ref}.remote`)) ||
    'origin'
  // Lookup the URL for the given remote.
  const url =
    _url ||
    (await config.get(`remote.${remote}.pushurl`)) ||
    (await config.get(`remote.${remote}.url`))
  if (typeof url === 'undefined') {
    throw new MissingParameterError('remote OR url')
  }
  // Figure out what remote ref to use.
  const remoteRef = _remoteRef || (await config.get(`branch.${ref}.merge`))
  if (typeof url === 'undefined') {
    throw new MissingParameterError('remoteRef')
  }

  if (corsProxy === undefined) {
    corsProxy = await config.get('http.corsProxy')
  }

  const fullRef = await GitRefManager.expand({ fs, gitdir, ref })
  const oid = _delete
    ? '0000000000000000000000000000000000000000'
    : await GitRefManager.resolve({ fs, gitdir, ref: fullRef })

  // const arweave = Arweave.init({
  //   host: 'arweave.net',
  //   port: 443,
  //   protocol: 'https',
  // })

  let fullRemoteRef
  if (!remoteRef) {
    fullRemoteRef = fullRef
  } else {
    try {
      fullRemoteRef = await GitRefManager.expandAgainstMap({
        ref: remoteRef,
        map: await getRefsOnArweave(arweave, url),
      })
    } catch (err) {
      if (err instanceof NotFoundError) {
        // The remote reference doesn't exist yet.
        // If it is fully specified, use that value. Otherwise, treat it as a branch.
        fullRemoteRef = remoteRef.startsWith('refs/')
          ? remoteRef
          : `refs/heads/${remoteRef}`
      } else {
        throw err
      }
    }
  }

  const oldoid = await getRef(arweave, url, fullRemoteRef)

  let objects = new Set()
  if (!_delete) {
    // const finish = [...httpRemote.refs.values()]
    // all refs on the remote
    const finish = []
    let skipObjects = new Set()

    // If remote branch is present, look for a common merge base.
    if (oldoid !== '0000000000000000000000000000000000000000') {
      // trick to speed up common force push scenarios
      const mergebase = await _findMergeBase({
        fs,
        gitdir,
        oids: [oid, oldoid],
      })
      for (const oid of mergebase) finish.push(oid)
      // thinpack
      skipObjects = await listObjects({ fs, gitdir, oids: mergebase })
      console.log('skipped ', skipObjects)
    }

    // If remote does not have the commit, figure out the objects to send
    if (!finish.includes(oid)) {
      const commits = await listCommitsAndTags({
        fs,
        gitdir,
        start: [oid],
        finish,
      })
      objects = await listObjects({ fs, gitdir, oids: commits })
    }

    //thinpack
    // If there's a default branch for the remote lets skip those objects too.
    // Since this is an optional optimization, we just catch and continue if there is
    // an error (because we can't find a default branch, or can't find a commit, etc)
    try {
      // Sadly, the discovery phase with 'forPush' doesn't return symrefs, so we have to
      // rely on existing ones.
      const ref = await GitRefManager.resolve({
        fs,
        gitdir,
        ref: `refs/remotes/${remote}/HEAD`,
        depth: 2,
      })
      const { oid } = await GitRefManager.resolveAgainstMap({
        ref: ref.replace(`refs/remotes/${remote}/`, ''),
        fullref: ref,
        map: new Map(),
      })
      const oids = [oid]
      for (const oid of await listObjects({ fs, gitdir, oids })) {
        skipObjects.add(oid)
      }
    } catch (e) {}

    // Remove objects that we know the remote already has
    for (const oid of skipObjects) {
      objects.delete(oid)
    }

    if (!force) {
      // Is it a tag that already exists?
      if (
        fullRef.startsWith('refs/tags') &&
        oldoid !== '0000000000000000000000000000000000000000'
      ) {
        throw new PushRejectedError('tag-exists')
      }
      // Is it a non-fast-forward commit?
      if (
        oid !== '0000000000000000000000000000000000000000' &&
        oldoid !== '0000000000000000000000000000000000000000' &&
        !(await _isDescendent({ fs, gitdir, oid, ancestor: oldoid, depth: -1 }))
      ) {
        throw new PushRejectedError('not-fast-forward')
      }
    }
  }

  const packfile = _delete
    ? {}
    : await _packObjects({
        fs,
        gitdir,
        oids: [...objects],
        write: false,
      })

  if (objects.size !== 0)
    await pushPackfile(arweave, wallet, url, oldoid, oid, packfile)

  await updateRef(arguments, wallet, url, fullRemoteRef, oid)

  // Update the local copy of the remote ref
  if (remote) {
    // TODO: I think this should actually be using a refspec transform rather than assuming 'refs/remotes/{remote}'
    const ref = `refs/remotes/${remote}/${fullRemoteRef.replace(
      'refs/heads',
      ''
    )}`
    if (_delete) {
      await GitRefManager.deleteRef({ fs, gitdir, ref })
    } else {
      await GitRefManager.writeRef({ fs, gitdir, ref, value: oid })
    }
  }
  // if (result.ok && Object.values(result.refs).every(result => result.ok)) {
  //   return result
  // } else {
  //   const prettyDetails = Object.entries(result.refs)
  //     .filter(([k, v]) => !v.ok)
  //     .map(([k, v]) => `\n  - ${k}: ${v.error}`)
  //     .join('')
  //   throw new GitPushError(prettyDetails, result)
  // }
}
