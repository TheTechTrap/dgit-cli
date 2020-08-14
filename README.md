# dgit-cli

To use it as a global cli install using `npm install -g @thetechtrap/dgit`

This is the dgit cli client to interact with [dgit.sh](https://dgit.sh) or [permaweb-link](https://arweave.net/CvDtHEdfFLjceZFS9wO9russvfBsAxYZGDl42j8Yey8)

PST Fee of 0.01 AR is only applicable on dgit push

## Steps to Build

- `npm install`
- `npm run build`
- `npm link`

## Commands

**Important** : `export ARWEAVE_WALLET_PATH=/path/to/wallet`

- `dgit init`
- `dgit status <filename>`
- `dgit add <filename>`
- `dgit config user.name <name>`
- `dgit config user.email <email>`
- `dgit commit -m <messge>`
- `dgit push <remote> <branch>`
- `dgit clone <dgit://address/repo_name>`
- `dgit log`

## Credits
We are thankful to [isomorphic-git](https://github.com/isomorphic-git/isomorphic-git)
