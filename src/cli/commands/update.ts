/**
 * BTW - Update Command
 * CLI command for updating workflows from their source
 */

import { Command } from 'commander';
import { workflowManager } from '../../core/workflow/WorkflowManager.js';
import { output } from '../utils/output.js';
import { BTWError } from '../../types/errors.js';
import ora from 'ora';

/**
 * Create the 'update' command
 */
export function createUpdateCommand(): Command {
  const command = new Command('update')
    .description('Update a workflow from its source repository')
    .argument('[workflow-id]', 'Workflow ID to update (updates all if not specified)')
    .option('-a, --all', 'Update all installed workflows')
    .action(async (workflowId: string | undefined, options: { all?: boolean }) => {
      await executeUpdate(workflowId, options);
    });

  return command;
}

/**
 * Execute the update command
 * @param workflowId - Optional workflow ID to update
 * @param options - Command options
 */
async function executeUpdate(
  workflowId: string | undefined,
  options: { all?: boolean }
): Promise<void> {
  try {
    // If --all flag or no workflow ID specified, update all workflows
    if (options.all || !workflowId) {
      await updateAllWorkflows();
    } else {
      await updateSingleWorkflow(workflowId);
    }
  } catch (error) {
    if (BTWError.isBTWError(error)) {
      output.formatError(error);
    } else {
      output.error(`Unexpected error: ${error}`);
    }
    process.exitCode = 1;
  }
}

/**
 * Update a single workflow
 * @param workflowId - Workflow ID to update
 */
async function updateSingleWorkflow(workflowId: string): Promise<void> {
  const spinner = ora(`Updating workflow '${workflowId}'...`).start();

  try {
    const result = await workflowManager.update(workflowId);

    if (result.success && result.data) {
      spinner.succeed(`Workflow '${workflowId}' updated successfully`);
      output.keyValue('Version', result.data.version);
      if (result.data.contentHash) {
        output.keyValue('Commit', result.data.contentHash.substring(0, 7));
      }
    } else {
      spinner.fail(`Failed to update workflow '${workflowId}'`);
      output.error(result.error || 'Unknown error');
      process.exitCode = 1;
    }
  } catch (error) {
    spinner.fail(`Failed to update workflow '${workflowId}'`);
    throw error;
  }
}

/**
 * Update all installed workflows
 */
async function updateAllWorkflows(): Promise<void> {
  // Get list of all workflows
  const listResult = await workflowManager.list({ detailed: true });

  if (!listResult.success || !listResult.data) {
    output.error(listResult.error || 'Failed to list workflows');
    process.exitCode = 1;
    return;
  }

  const workflows = listResult.data;

  if (workflows.length === 0) {
    output.info('No workflows installed');
    return;
  }

  output.info(`Updating ${workflows.length} workflow(s)...\n`);

  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (const workflow of workflows) {
    const workflowId = workflow.state.workflowId;
    const spinner = ora(`Updating '${workflowId}'...`).start();

    try {
      const result = await workflowManager.update(workflowId);

      if (result.success && result.data) {
        spinner.succeed(`'${workflowId}' updated to ${result.data.version}`);
        successCount++;
      } else {
        // Check if it's a local workflow (can't be updated)
        if (result.error?.includes('local path')) {
          spinner.warn(`'${workflowId}' skipped (local workflow)`);
          skipCount++;
        } else {
          spinner.fail(`'${workflowId}' failed: ${result.error}`);
          failCount++;
        }
      }
    } catch (error) {
      spinner.fail(`'${workflowId}' failed: ${(error as Error).message}`);
      failCount++;
    }
  }

  // Summary
  output.newline();
  output.divider();

  if (successCount > 0) {
    output.success(`${successCount} workflow(s) updated`);
  }
  if (skipCount > 0) {
    output.info(`${skipCount} workflow(s) skipped`);
  }
  if (failCount > 0) {
    output.error(`${failCount} workflow(s) failed`);
    process.exitCode = 1;
  }
}

export default createUpdateCommand;
