import { ExecutionPlan, ExecutionTask } from './types';

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
 * Parse individual task elements from the tasks XML section
 *
 * @param tasksSection - Content of the <tasks> section
 * @returns Array of parsed execution tasks
 */
export function parseTasksXml(tasksSection: string): ExecutionTask[] {
  const tasks: ExecutionTask[] = [];

  // Match <task type="..."> elements - handle multi-line content
  const taskPattern = /<task\s+type=["']([^"']+)["']>([\s\S]*?)<\/task>/gi;
  let taskMatch;
  let taskIndex = 0;

  while ((taskMatch = taskPattern.exec(tasksSection)) !== null) {
    taskIndex++;
    const type = taskMatch[1] as ExecutionTask['type'];
    const taskContent = taskMatch[2];

    // Extract nested elements
    const nameMatch = taskContent.match(/<name>([\s\S]*?)<\/name>/i);
    const filesMatch = taskContent.match(/<files>([\s\S]*?)<\/files>/i);
    const actionMatch = taskContent.match(/<action>([\s\S]*?)<\/action>/i);
    const verifyMatch = taskContent.match(/<verify>([\s\S]*?)<\/verify>/i);
    const doneMatch = taskContent.match(/<done>([\s\S]*?)<\/done>/i);

    // Parse name - strip "Task N:" prefix if present
    let name = nameMatch ? nameMatch[1].trim() : `Task ${taskIndex}`;
    const taskPrefixMatch = name.match(/^Task\s+\d+:\s*(.+)$/i);
    if (taskPrefixMatch) {
      name = taskPrefixMatch[1];
    }

    // Parse files - split by comma
    let files: string[] | undefined;
    if (filesMatch) {
      files = filesMatch[1].trim().split(/,\s*/).filter(f => f.length > 0);
    }

    tasks.push({
      id: taskIndex,
      name,
      type: type === 'auto' || type === 'checkpoint:human-verify' || type === 'checkpoint:decision'
        ? type
        : 'auto',
      files,
      action: actionMatch ? actionMatch[1].trim() : '',
      verify: verifyMatch ? verifyMatch[1].trim() : '',
      done: doneMatch ? doneMatch[1].trim() : '',
      status: 'pending'
    });
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

    // Parse plan number from frontmatter
    const planNumber = parseInt(frontmatter.plan, 10) || 1;

    return {
      phase: frontmatter.phase,
      planNumber,
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
