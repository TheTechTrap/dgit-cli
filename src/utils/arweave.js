import axios from 'axios'

const graphQlEndpoint = 'https://arweave.net/graphql'

// prettier-ignore
const argitRemoteURIRegex = '^dgit:\/\/([a-zA-Z0-9-_]{43})\/([A-Za-z0-9_.-]*)'

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
            { name: "Repo", values: ["${repoName}"] }
            { name: "version", values: ["0.0.2"] }
            { name: "ref", values: ["${ref}"] }
            { name: "Type", values: ["update-ref"] }
            { name: "App-Name", values: ["dgit"] }
          ]
          first: 10
        ) {
          edges {
            node {
              id
              tags {
                name
                value
              }
              block {
                height
              }
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

  edges.sort((a, b) => {
    if ((b.node.block.height - a.node.block.height) < 50) {
      const bUnixTime = Number(getTagValue("Unix-Time", b.node.tags))
      const aUnixTime = Number(getTagValue("Unix-Time", a.node.tags))
      return bUnixTime - aUnixTime
    }
    return 0
  })

  const id = edges[0].node.id
  return await arweave.transactions.getData(id, {
    decode: true,
    string: true,
  })
}

export const getAllRefs = async (arweave, remoteURI) => {
  let refs = new Set();
  let refOidObj = {};
  const { repoOwnerAddress, repoName } = parseArgitRemoteURI(remoteURI);
  const { data } = await axios({
    url: graphQlEndpoint,
    method: "post",
    data: {
      query: `
      query {
        transactions(
          owners: ["${repoOwnerAddress}"]
          tags: [
            { name: "Repo", values: ["${repoName}"] }
            { name: "Type", values: ["update-ref"] }
            { name: "App-Name", values: ["dgit"] }
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
  });

  const edges = data.data.transactions.edges;

  for (const edge of edges) {
    for (const tag of edge.node.tags) {
      if (tag.name === "ref") {
        refs.add(tag.value);
        break
      }
    }
  }

  for (const ref of refs) {
    refOidObj[ref] = await getOidByRef(arweave, remoteURI, ref);
  }

  return refOidObj;
};

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
