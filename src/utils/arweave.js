import axios from 'axios'

const graphQlEndpoint = 'https://arweave.net/graphql'

// prettier-ignore
const argitRemoteURIRegex = '^gitopia:\/\/([a-zA-Z0-9-_]{43})\/([A-Za-z0-9_.-]*)'

export function parseArgitRemoteURI(remoteURI) {
  const matchGroups = remoteURI.match(argitRemoteURIRegex)
  const repoOwnerAddress = matchGroups[1]
  const repoName = matchGroups[2]

  return { repoOwnerAddress, repoName }
}

export async function fetchGitObject(arweave, remoteURI, oid) {
  const id = await getTransactionIdByObjectId(remoteURI, oid)
  return await arweave.transactions.getData(id, { decode: true })
}

const getTagValue = (tagName, tags) => {
  for (const tag of tags) {
    if (tag.name === tagName) {
      return tag.value
    }
  }
}

export const getOidByRef = async (arweave, remoteURI, ref) => {
  const { repoOwnerAddress, repoName } = parseArgitRemoteURI(remoteURI)
  const { data } = await axios({
    url: graphQlEndpoint,
    method: 'post',
    data: {
      query: `
      query {
        transactions(
          owners: ["${repoOwnerAddress}"]
          tags: [
            { name: "Type", values: ["update-ref"] }
            { name: "Repo", values: ["${repoName}"] }
            { name: "Version", values: ["0.0.2"] }
            { name: "Ref", values: ["${ref}"] }
            { name: "App-Name", values: ["Gitopia"] }
          ]
          first: 1
        ) {
          edges {
            node {
              id
            }
          }
        }
      }`,
    },
  })

  const edges = data.data.transactions.edges
  if (edges.length === 0) {
    return {
      oid: null,
      numCommits: 0,
    }
  }

  const id = edges[0].node.id
  const response = await arweave.transactions.getData(id, {
    decode: true,
    string: true,
  })

  return JSON.parse(response)
}

export const getAllRefs = async (arweave, remoteURI) => {
  let refs = new Set()
  let refOidObj = {}
  const { repoOwnerAddress, repoName } = parseArgitRemoteURI(remoteURI)
  const { data } = await axios({
    url: graphQlEndpoint,
    method: 'post',
    data: {
      query: `
      query {
        transactions(
          first: 2147483647
          owners: ["${repoOwnerAddress}"]
          tags: [
            { name: "Type", values: ["update-ref"] }
            { name: "Repo", values: ["${repoName}"] }
            { name: "Version", values: ["0.0.2"] }
            { name: "App-Name", values: ["Gitopia"] }
          ]
        ) {
          edges {
            node {
              tags {
                name
                value
              }
            }
          }
        }
      }`,
    },
  })

  const edges = data.data.transactions.edges

  for (const edge of edges) {
    for (const tag of edge.node.tags) {
      if (tag.name === 'Ref') {
        refs.add(tag.value)
        break
      }
    }
  }

  for (const ref of refs) {
    const { oid } = await getOidByRef(arweave, remoteURI, ref)
    refOidObj[ref] = oid
  }

  return refOidObj
}

export const getTransactionIdByObjectId = async (remoteURI, oid) => {
  const { repoOwnerAddress, repoName } = parseArgitRemoteURI(remoteURI)
  const { data } = await axios({
    url: graphQlEndpoint,
    method: 'post',
    data: {
      query: `
      query {
        transactions(
          owners: ["${repoOwnerAddress}"]
          tags: [
            { name: "Oid", values: ["${oid}"] }
            { name: "Version", values: ["0.0.2"] }
            { name: "Repo", values: ["${repoName}"] }
            { name: "Type", values: ["git-object"] }
            { name: "App-Name", values: ["Gitopia"] }
          ]
          first: 1
        ) {
          edges {
            node {
              id
            }
          }
        }
      }`,
    },
  })

  const edges = data.data.transactions.edges
  return edges[0].node.id
}
