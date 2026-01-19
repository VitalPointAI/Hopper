import {
  ExecutionPlan,
  ExecutionTask,
  AutoExecutionTask,
  CheckpointVerifyTask,
  CheckpointDecisionTask,
  DecisionOption
} from './types';

/**
 * Parse YAML frontmatter from PLAN.md content
 * Returns frontmatter values and the remaining content
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    return { frontmatter: {}, body: content };
  }

  const frontmatter: Record<string, string> = {};
  const frontmatterLines = frontmatterMatch[1].split('\n');

  for (const line of frontmatterLines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      frontmatter[key] = value;
    }
  }

  return {
    frontmatter,
    body: frontmatterMatch[2]
  };
}

/**
 * Extract content between XML-like tags
 *
 * @param content - Content to search
 * @param tagName - Tag name to find (without angle brackets)
 * @returns Content between tags, or null if not found
 */
function extractSection(content: string, tagName: string): string | null {
  const pattern = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'i');
  const match = content.match(pattern);
  return match ? match[1].trim() : null;
}

/**
 * Parse decision options from <options> XML content
 */
function parseDecisionOptions(optionsContent: string): DecisionOption[] {
  const options: DecisionOption[] = [];
  const optionPattern = /<option\s+id=["']([^"']+)["']>([\s\S]*?)<\/option>/gi;
  let match;

  while ((match = optionPattern.exec(optionsContent)) !== null) {
    const id = match[1];
    const content = match[2];

    const nameMatch = content.match(/<name>([\s\S]*?)<\/name>/i);
    const prosMatch = content.match(/<pros>([\s\S]*?)<\/pros>/i);
    const consMatch = content.match(/<cons>([\s\S]*?)<\/cons>/i);

    options.push({
      id,
      name: nameMatch ? nameMatch[1].trim() : id,
      pros: prosMatch ? prosMatch[1].trim() : '',
      cons: consMatch ? consMatch[1].trim() : ''
    });
  }

  return options;
}

/**
 * Parse verification steps from how-to-verify content
 * Splits numbered steps into an array
 */
function parseVerifySteps(content: string): string[] {
  const steps: string[] = [];
  const lines = content.trim().split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Match numbered steps: "1. Step" or "1) Step"
    const stepMatch = trimmed.match(/^\d+[.)]\s*(.+)$/);
    if (stepMatch) {
      steps.push(stepMatch[1].trim());
    } else if (trimmed && !trimmed.match(/^\d+[.)]/)) {
      // Non-numbered non-empty lines are also steps
      steps.push(trimmed);
    }
  }

  return steps;
}

/**
 * Parse individual task elements from the tasks XML section
 *
 * @param tasksSection - Content of the <tasks> section
 * @returns Array of parsed execution tasks
 */
export function parseTasksXml(tasksSection: string): ExecutionTask[] {
  const tasks: ExecutionTask[] = [];

  // Match <task type="..."> elements - handle multi-line content and optional gate attribute
  const taskPattern = /<task\s+type=["']([^"']+)["'][^>]*>([\s\S]*?)<\/task>/gi;
  let taskMatch;
  let taskIndex = 0;

  while ((taskMatch = taskPattern.exec(tasksSection)) !== null) {
    taskIndex++;
    const type = taskMatch[1];
    const taskContent = taskMatch[2];

    // Parse name - strip "Task N:" prefix if present
    const nameMatch = taskContent.match(/<name>([\s\S]*?)<\/name>/i);
    let name = nameMatch ? nameMatch[1].trim() : `Task ${taskIndex}`;
    const taskPrefixMatch = name.match(/^Task\s+\d+:\s*(.+)$/i);
    if (taskPrefixMatch) {
      name = taskPrefixMatch[1];
    }

    // Route to appropriate parser based on type
    if (type === 'checkpoint:human-verify') {
      const whatBuiltMatch = taskContent.match(/<what-built>([\s\S]*?)<\/what-built>/i);
      const howToVerifyMatch = taskContent.match(/<how-to-verify>([\s\S]*?)<\/how-to-verify>/i);
      const resumeSignalMatch = taskContent.match(/<resume-signal>([\s\S]*?)<\/resume-signal>/i);

      const checkpointTask: CheckpointVerifyTask = {
        id: taskIndex,
        name,
        type: 'checkpoint:human-verify',
        status: 'pending',
        whatBuilt: whatBuiltMatch ? whatBuiltMatch[1].trim() : '',
        howToVerify: howToVerifyMatch ? parseVerifySteps(howToVerifyMatch[1]) : [],
        resumeSignal: resumeSignalMatch ? resumeSignalMatch[1].trim() : 'Type "approved" to continue'
      };
      tasks.push(checkpointTask);

    } else if (type === 'checkpoint:decision') {
      const decisionMatch = taskContent.match(/<decision>([\s\S]*?)<\/decision>/i);
      const contextMatch = taskContent.match(/<context>([\s\S]*?)<\/context>/i);
      const optionsMatch = taskContent.match(/<options>([\s\S]*?)<\/options>/i);
      const resumeSignalMatch = taskContent.match(/<resume-signal>([\s\S]*?)<\/resume-signal>/i);

      const decisionTask: CheckpointDecisionTask = {
        id: taskIndex,
        name,
        type: 'checkpoint:decision',
        status: 'pending',
        decision: decisionMatch ? decisionMatch[1].trim() : '',
        context: contextMatch ? contextMatch[1].trim() : '',
        options: optionsMatch ? parseDecisionOptions(optionsMatch[1]) : [],
        resumeSignal: resumeSignalMatch ? resumeSignalMatch[1].trim() : 'Select an option to continue'
      };
      tasks.push(decisionTask);

    } else {
      // Default: auto task
      const filesMatch = taskContent.match(/<files>([\s\S]*?)<\/files>/i);
      const actionMatch = taskContent.match(/<action>([\s\S]*?)<\/action>/i);
      const verifyMatch = taskContent.match(/<verify>([\s\S]*?)<\/verify>/i);
      const doneMatch = taskContent.match(/<done>([\s\S]*?)<\/done>/i);

      // Parse files - split by comma and filter out placeholder text
      let files: string[] | undefined;
      if (filesMatch) {
        const parsed = filesMatch[1].trim().split(/,\s*/).filter(f =>
          f.length > 0 &&
          !f.startsWith('[') &&  // Filter out [Identify affected files...] placeholders
          !f.startsWith('{')     // Filter out {template} variables
        );
        files = parsed.length > 0 ? parsed : undefined;
      }

      const autoTask: AutoExecutionTask = {
        id: taskIndex,
        name,
        type: 'auto',
        status: 'pending',
        files,
        action: actionMatch ? actionMatch[1].trim() : '',
        verify: verifyMatch ? verifyMatch[1].trim() : '',
        done: doneMatch ? doneMatch[1].trim() : ''
      };
      tasks.push(autoTask);
    }
  }

  return tasks;
}

/**
 * Parse verification checklist items from content
 *
 * @param content - Verification section content
 * @returns Array of verification items
 */
function parseVerificationItems(content: string): string[] {
  const items: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    // Match "- [ ] item" or "- [x] item" patterns
    const checkboxMatch = line.match(/^-\s*\[[x\s]\]\s*(.+)$/i);
    if (checkboxMatch) {
      items.push(checkboxMatch[1].trim());
    }
  }

  return items;
}

/**
 * Parse success criteria items from content
 *
 * @param content - Success criteria section content
 * @returns Array of success criteria items
 */
function parseSuccessCriteria(content: string): string[] {
  const items: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    // Match "- item" patterns
    const bulletMatch = line.match(/^-\s+(.+)$/);
    if (bulletMatch) {
      items.push(bulletMatch[1].trim());
    }
  }

  return items;
}

/**
 * Parse PLAN.md content into an ExecutionPlan
 *
 * @param content - Full PLAN.md file content
 * @returns Parsed ExecutionPlan or null if parsing fails
 */
export function parsePlanMd(content: string): ExecutionPlan | null {
  try {
    // Parse frontmatter
    const { frontmatter, body } = parseFrontmatter(content);

    // Validate required frontmatter
    if (!frontmatter.phase) {
      console.log('parsePlanMd: missing phase in frontmatter');
      return null;
    }

    // Extract objective section
    const objectiveSection = extractSection(body, 'objective');
    if (!objectiveSection) {
      console.log('parsePlanMd: missing objective section');
      return null;
    }

    // Parse objective and purpose from objective section
    let objective = objectiveSection;
    let purpose = '';

    const purposeMatch = objectiveSection.match(/Purpose:\s*(.+?)(?:\n|$)/);
    if (purposeMatch) {
      purpose = purposeMatch[1].trim();
      // Extract just the objective (first paragraph)
      objective = objectiveSection.split(/\n\n/)[0].trim();
    }

    // Extract and parse tasks section
    const tasksSection = extractSection(body, 'tasks');
    if (!tasksSection) {
      console.log('parsePlanMd: missing tasks section');
      return null;
    }

    const tasks = parseTasksXml(tasksSection);
    if (tasks.length === 0) {
      console.log('parsePlanMd: no tasks found in tasks section');
      return null;
    }

    // Extract verification section
    const verificationSection = extractSection(body, 'verification');
    const verification = verificationSection
      ? parseVerificationItems(verificationSection)
      : [];

    // Extract success criteria section
    const successCriteriaSection = extractSection(body, 'success_criteria');
    const successCriteria = successCriteriaSection
      ? parseSuccessCriteria(successCriteriaSection)
      : [];

    // Parse plan number from frontmatter (numeric portion)
    const planNumber = parseInt(frontmatter.plan, 10) || 1;
    // Store raw plan value to preserve FIX suffixes (e.g., "02-FIX-FIX")
    const rawPlan = frontmatter.plan || String(planNumber);

    return {
      phase: frontmatter.phase,
      planNumber,
      rawPlan,
      objective,
      purpose,
      tasks,
      verification,
      successCriteria
    };
  } catch (error) {
    console.error('parsePlanMd error:', error);
    return null;
  }
}
