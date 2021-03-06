import * as smartweave from 'smartweave'
import { getTransactionIdByObjectId } from './graphql'

// prettier-ignore
const argitRemoteURIRegex = '^dgit:\/\/([a-zA-Z0-9-_]{43})\/([A-Za-z0-9_.-]*)'
const contractId = 'N9Vfr_3Rw95111UJ6eaT7scGZzDCd2zzpja890758Qc'

const repoQuery = remoteURI => {
  const { repoOwnerAddress, repoName } = parseArgitRemoteURI(remoteURI)
  return {
    op: 'and',
    expr1: {
      op: 'and',
      expr1: {
        op: 'equals',
        expr1: 'App-Name',
        expr2: 'dgit',
      },
      expr2: {
        op: 'equals',
        expr1: 'from',
        expr2: repoOwnerAddress,
      },
    },
    expr2: { op: 'equals', expr1: 'Repo', expr2: repoName },
  }
}

export function parseArgitRemoteURI(remoteURI) {
  const matchGroups = remoteURI.match(argitRemoteURIRegex)
  const repoOwnerAddress = matchGroups[1]
  const repoName = matchGroups[2]

  return { repoOwnerAddress, repoName }
}

function addTransactionTags(tx, repo, txType) {
  tx.addTag('Repo', repo)
  tx.addTag('Type', txType)
  tx.addTag('Content-Type', 'application/json')
  tx.addTag('App-Name', 'dgit')
  tx.addTag('version', '0.0.1')
  tx.addTag('Unix-Time', Math.round(new Date().getTime() / 1000)) // Add Unix timestamp
  return tx
}

export async function updateRef(arweave, wallet, remoteURI, name, ref) {
  const { repoName } = parseArgitRemoteURI(remoteURI)
  let tx = await arweave.createTransaction({ data: ref }, wallet)
  tx = addTransactionTags(tx, repoName, 'update-ref')
  tx.addTag('ref', name)

  await arweave.transactions.sign(tx, wallet) // Sign transaction
  arweave.transactions.post(tx) // Post transaction
}

export async function pushPackfile(
  arweave,
  wallet,
  remoteURI,
  oldoid,
  oid,
  packfile
) {
  const { repoName } = parseArgitRemoteURI(remoteURI)

  let tx = await arweave.createTransaction({ data: packfile.packfile }, wallet)
  tx = addTransactionTags(tx, repoName, 'send-pack')
  tx.addTag('oid', oid)
  tx.addTag('oldoid', oldoid)
  tx.addTag('filename', packfile.filename)

  await arweave.transactions.sign(tx, wallet)
  let uploader = await arweave.transactions.getUploader(tx)

  while (!uploader.isComplete) {
    await uploader.uploadChunk()
    console.log(
      `${uploader.pctComplete}% complete, ${uploader.uploadedChunks}/${uploader.totalChunks}`
    )
  }

  // Send fee to PST holders
  const contractState = await smartweave.readContract(arweave, contractId)
  const holder = smartweave.selectWeightedPstHolder(contractState.balances)
  // send a fee. You should inform the user about this fee and amount.
  const pstTx = await arweave.createTransaction(
    { target: holder, quantity: arweave.ar.arToWinston('0.01') },
    wallet
  )
  pstTx.addTag('App-Name', 'dgit')
  pstTx.addTag('version', '0.0.1')

  await arweave.transactions.sign(pstTx, wallet)
  await arweave.transactions.post(pstTx)
}

export async function fetchPackfiles(arweave, remoteURI) {
  const query = {
    op: 'and',
    expr1: repoQuery(remoteURI),
    expr2: { op: 'equals', expr1: 'Type', expr2: 'send-pack' },
  }
  const txids = await arweave.arql(query)
  const packfiles = await Promise.all(
    txids.map(async txid => {
      const tx = await arweave.transactions.get(txid)
      let filename = ''
      tx.get('tags').forEach(tag => {
        const key = tag.get('name', { decode: true, string: true })
        const value = tag.get('value', { decode: true, string: true })
        if (key === 'filename') filename = value
      })
      const data = await arweave.transactions.getData(txid, { decode: true })
      return { data, filename }
    })
  )
  return packfiles
}

export async function fetchGitObject(arweave, remoteURI, oid) {
  const id = await getTransactionIdByObjectId(remoteURI, oid)
  return await arweave.transactions.getData(id, { decode: true })
}

export async function fetchGitObjects(arweave, remoteURI) {
  const query = {
    op: 'and',
    expr1: repoQuery(remoteURI),
    expr2: { op: 'equals', expr1: 'Type', expr2: 'push-git-object' },
  }
  const txids = await arweave.arql(query)
  const objects = await Promise.all(
    txids.map(async txid => {
      const tx = await arweave.transactions.get(txid)
      let oid = ''
      tx.get('tags').forEach(tag => {
        const key = tag.get('name', { decode: true, string: true })
        const value = tag.get('value', { decode: true, string: true })
        if (key === 'oid') oid = value
      })
      const data = await arweave.transactions.getData(txid, { decode: true })
      return { data, oid }
    })
  )
  return objects
}

export async function getRefsOnArweave(arweave, remoteURI) {
  const refs = new Map()
  const query = {
    op: 'and',
    expr1: repoQuery(remoteURI),
    expr2: { op: 'equals', expr1: 'Type', expr2: 'update-ref' },
  }
  const txids = await arweave.arql(query)
  const tx_rows = await Promise.all(
    txids.map(async txid => {
      let ref = {}
      const tx = await arweave.transactions.get(txid)
      tx.get('tags').forEach(tag => {
        const key = tag.get('name', { decode: true, string: true })
        const value = tag.get('value', { decode: true, string: true })
        if (key === 'Unix-Time') ref.unixTime = value
        else if (key === 'ref') ref.name = value
      })

      ref.oid = await arweave.transactions.getData(txid, {
        decode: true,
        string: true,
      })

      return ref
    })
  )

  // descending order
  tx_rows.sort((a, b) => {
    Number(b.unixTime) - Number(a.unixTime)
  })

  tx_rows.forEach(ref => {
    if (!refs.has(ref.name)) refs.set(ref.name, ref.oid)
  })

  return refs
}
