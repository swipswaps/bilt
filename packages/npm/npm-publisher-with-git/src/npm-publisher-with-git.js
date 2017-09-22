'use strict'
const {promisify: p} = require('util')
const fs = require('fs')
const os = require('os')
const path = require('path')
const debug = require('debug')('bildit:npm-publisher-with-git')
const {initializer} = require('@bildit/agent-commons')

module.exports = initializer(
  async (
    {ensureAgentInstanceInitialized},
    {
      config: {
        npmAuthenticationLine,
        access: access = 'restricted',
        usedLocally = !npmAuthenticationLine,
      },
      pimport,
    },
  ) => {
    const vcs = await pimport('vcs')
    return {
      async publishPackage(job, {agentInstance}) {
        debug(`publishing for job ${job}`)
        const {homeDir, agent} = await ensureAgentInstanceInitialized({agentInstance})

        const {artifactPath} = job

        await ensureNoDirtyGitFiles(vcs, agent, agentInstance, artifactPath)

        debug('patching package.json version')
        const versionOutput = await agent.executeCommand(
          agentInstance,
          ['npm', 'version', 'patch', '--force', '--no-git-tag-version'],
          {
            cwd: artifactPath,
            returnOutput: true,
            env: {HOME: homeDir},
          },
        )
        debug('npm version output is %s', versionOutput)

        const newVersion = versionOutput.match(/^(v.*)$/m)[0]

        debug('committing patch changes %s', newVersion)

        await vcs.commitAndPush({agentInstance, message: newVersion})

        debug('npm publishing')
        await agent.executeCommand(agentInstance, ['npm', 'publish', '--access', access], {
          cwd: artifactPath,
          env: {HOME: homeDir},
        })
      },
      async [initializer.initializationFunction]({agentInstance}) {
        const agent = await pimport(agentInstance.kind)
        const homeDir =
          usedLocally && npmAuthenticationLine
            ? await p(fs.mkdtemp)(os.tmpdir())
            : await agent.homeDir(agentInstance)

        if (npmAuthenticationLine) {
          debug('creating npmrc with authentication line')

          await createAuthenticationNpmRc(agent, agentInstance, npmAuthenticationLine, homeDir)
        }

        return {homeDir, agent}
      },
    }
  },
)

async function createAuthenticationNpmRc(agent, agentInstance, npmAuthenticationLine, homeDir) {
  await agent.writeBufferToFile(
    agentInstance,
    path.join(homeDir, '.npmrc'),
    Buffer.from(npmAuthenticationLine),
  )
}

async function ensureNoDirtyGitFiles(vcs, agent, agentInstance, artifactPath) {
  const dirtyFiles = vcs.listDirtyFiles({agentInstance})

  if (dirtyFiles.length > 0) {
    throw new Error(
      `Cannot publish artifact in ${artifactPath} because it has dirty files:\n${dirtyFiles}`,
    )
  }
}
