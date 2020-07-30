import { parse } from 'querystring'

// prettier-ignore
const argitRemoteURIRegex = '^argit:\/\/([a-zA-Z0-9-_]{43})\/([A-Za-z0-9_.-]*)'

const repoQuery = remoteURI => {
  const { repoOwnerAddress, repoName } = parseArgitRemoteURI(remoteURI)
  return {
    op: 'and',
    expr1: {
      op: 'and',
      expr1: {
        op: 'equals',
        expr1: 'App-Name',
        expr2: 'argit',
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

function parseArgitRemoteURI(remoteURI) {
  const matchGroups = remoteURI.match(argitRemoteURIRegex)
  const repoOwnerAddress = matchGroups[1]
  const repoName = matchGroups[2]

  return { repoOwnerAddress, repoName }
}

function addTransactionTags(tx, repo, txType) {
  tx.addTag('Repo', repo)
  tx.addTag('Type', txType)
  tx.addTag('Content-Type', 'application/json')
  tx.addTag('App-Name', 'argit')
  tx.addTag('version', '0.0.1')
  tx.addTag('Unix-Time', Math.round(new Date().getTime() / 1000)) // Add Unix timestamp
  return tx
}

export async function updateRef(arweave, wallet, remoteURI, name, ref) {
  const { repoName } = parseArgitRemoteURI(remoteURI)
  const data = JSON.stringify({ name, ref })
  let tx = await arweave.createTransaction({ data }, wallet)
  tx = addTransactionTags(tx, repoName, 'update-ref')

  await arweave.transactions.sign(tx, wallet) // Sign transaction
  arweave.transactions.post(tx) // Post transaction
}

export async function getRef(arweave, remoteURI, name) {
  const query = {
    op: 'and',
    expr1: repoQuery(remoteURI),
    expr2: { op: 'equals', expr1: 'Type', expr2: 'update-ref' },
  }
  const txids = await arweave.arql(query)
  const tx_rows = await Promise.all(
    txids.map(async txid => {
      let tx_row = {}
      const tx = await arweave.transactions.get(txid)
      tx.get('tags').forEach(tag => {
        const key = tag.get('name', { decode: true, string: true })
        const value = tag.get('value', { decode: true, string: true })
        if (key === 'Unix-Time') tx_row.unixTime = value
      })

      const data = tx.get('data', { decode: true, string: true })
      const decoded = JSON.parse(data)
      tx_row.name = decoded.name
      tx_row.value = decoded.ref

      return tx_row
    })
  )

  const refs = tx_rows.filter(tx_row => tx_row.name === name)
  if (refs.length === 0) return '0000000000000000000000000000000000000000'

  // descending order
  tx_rows.sort((a, b) => {
    Number(b.unixTime) - Number(a.unixTime)
  })
  return tx_rows[0].ref
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
  const data = JSON.stringify({ oldoid, oid, packfile })
  let tx = await arweave.createTransaction({ data }, wallet)
  tx = addTransactionTags(tx, repoName, 'send-pack')

  await arweave.transactions.sign(tx, wallet)
  arweave.transactions.post(tx) // Post transaction
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
      const data = await arweave.transactions.getData(txid, {
        decode: true,
        string: true,
      })
      return JSON.parse(data)
    })
  )
  return packfiles
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
      })

      const data = tx.get('data', { decode: true, string: true })
      const decoded = JSON.parse(data)
      ref.name = decoded.name
      ref.value = decoded.ref

      return ref
    })
  )

  // descending order
  tx_rows.sort((a, b) => {
    Number(b.unixTime) - Number(a.unixTime)
  })

  tx_rows.forEach(ref => {
    if (!refs.has(ref.name)) refs.set(ref.name, ref.value)
  })

  return refs
}
