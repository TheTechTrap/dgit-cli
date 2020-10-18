import axios from 'axios'
import { parseArgitRemoteURI } from './arweave'

const graphQlEndpoint = 'https://arweave.net/graphql'

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
            { name: "Repo", values: ["${repoName}"] }
            { name: "ref", values: ["${ref}"] }
            { name: "Type", values: ["update-ref"] }
            { name: "App-Name", values: ["dgit"] }
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
    return '0000000000000000000000000000000000000000'
  }

  const id = edges[0].node.id
  return await arweave.transactions.getData(id, {
    decode: true,
    string: true,
  })
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
            { name: "oid", values: ["${oid}"] }
            { name: "Repo", values: ["${repoName}"] }
            { name: "Type", values: ["push-git-object"] }
            { name: "App-Name", values: ["dgit"] }
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
