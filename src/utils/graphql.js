import axios from 'axios'
import { parseArgitRemoteURI } from './arweave'

const graphQlEndpoint = 'https://arweave.net/graphql'

export const getOidByRef = async (arweave, remoteURI, ref) => {
  const { repoOnwerAddress, repoName } = parseArgitRemoteURI(remoteURI)
  const { response } = await axios({
    url: graphQlEndpoint,
    method: 'post',
    data: {
      query: `
      query {
        transactions(
          owners: ["${repoOnwerAddress}"]
          tags: [
            { name: "App-Name", values: ["dgit"] }
            { name: "Repo", values: ["${repoName}"] }
            { name: "Type", values: ["update-ref"] }
            { name: "ref", values: ["${ref}"] }
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

  const parsedResponse = JSON.parse(response)
  const edges = parsedResponse.data.transactions.edges

  if (edges.length === 0) {
    return '0000000000000000000000000000000000000000'
  }

  const id = edges[0].node.id
  return await arweave.transactions.getData(txid, {
    decode: true,
    string: true,
  })
}

export const getTransactionIdByObjectId = async (remoteURI, oid) => {
  const { repoOnwerAddress, repoName } = parseArgitRemoteURI(remoteURI)
  const { response } = await axios({
    url: graphQlEndpoint,
    method: 'post',
    data: {
      query: `
      query {
        transactions(
          owners: ["${repoOnwerAddress}"]
          tags: [
            { name: "App-Name", values: ["dgit"] }
            { name: "Repo", values: ["${repoName}"] }
            { name: "Type", values: ["push-git-object"] }
            { name: "oid", values: ["${oid}"] }
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

  const parsedResponse = JSON.parse(response)
  return parsedResponse.data.transactions.edges[0].node.id
}
