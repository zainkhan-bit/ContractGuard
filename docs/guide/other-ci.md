# Other CI systems

The CLI works anywhere Node.js 24 runs. Two things matter in CI:

1. **The base revision must exist in the clone.** Shallow clones often lack it; fetch the target branch first.
2. **Keep the reports.** `--format markdown,json,sarif` writes `<spec-id>.{md,json,sarif}` to `--output-dir`.

With `CI=true` (set by most CI systems) ContractGuard disables colour, writes a JSON report by default, and applies the
[trust rules](/guide/configuration#split-specifications-and-remote-references) for remote references.

## GitLab CI

```yaml
api-contract:
  image: node:24
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  script:
    - git fetch --depth=1 origin "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
    - npx --yes contractguard check "git:origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME:openapi.yaml" openapi.yaml
      --format console,markdown,json --output-dir reports
  artifacts:
    when: always
    paths: [reports/]
```

## Azure Pipelines

```yaml
pool: { vmImage: ubuntu-latest }
steps:
  - checkout: self
    fetchDepth: 0
  - task: UseNode@1
    inputs: { version: '24.x' }
  - script: npx --yes contractguard check "git:origin/$(System.PullRequest.TargetBranch):openapi.yaml" openapi.yaml --format console,sarif --output-dir $(Build.ArtifactStagingDirectory)/contractguard
    displayName: API contract
  - publish: $(Build.ArtifactStagingDirectory)/contractguard
    artifact: contractguard
    condition: always()
```

## Jenkins

```groovy
stage('API contract') {
  steps {
    sh 'git fetch --depth=1 origin main'
    sh 'npx --yes contractguard check git:origin/main:openapi.yaml openapi.yaml --format console,json --output-dir reports'
  }
  post { always { archiveArtifacts artifacts: 'reports/**', allowEmptyArchive: true } }
}
```

## CircleCI

```yaml
jobs:
  api-contract:
    docker: [{ image: cimg/node:24.0 }]
    steps:
      - checkout
      - run: git fetch --depth=1 origin main
      - run: npx --yes contractguard check git:origin/main:openapi.yaml openapi.yaml --format console,json --output-dir reports
      - store_artifacts: { path: reports }
```

## Bitbucket Pipelines

```yaml
pipelines:
  pull-requests:
    '**':
      - step:
          image: node:24
          script:
            - git fetch origin "$BITBUCKET_PR_DESTINATION_BRANCH"
            - npx --yes contractguard check "git:origin/$BITBUCKET_PR_DESTINATION_BRANCH:openapi.yaml" openapi.yaml --format console,json --output-dir reports
          artifacts: [reports/**]
```

## Without git history

Freeze the released version once and compare against the snapshot:

```sh
npx @zainkhan-bit/contractguard baseline create openapi.yaml -o contract/v1.snapshot.json   # commit this file
npx @zainkhan-bit/contractguard check snapshot:contract/v1.snapshot.json openapi.yaml
```

Snapshots contain every document of the spec with SHA-256 checksums; edited snapshots are rejected.
