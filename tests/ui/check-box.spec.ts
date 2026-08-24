import { test } from '../../src/ui/fixtures';
import { CheckBoxSteps } from '../../src/ui/steps/check-box.steps';

test.describe('DemoQA UI @ Check Box', () => {
  test('Checking a parent node selects every node in its subtree', async ({ page }) => {
    const steps = new CheckBoxSteps(page);

    await steps.openCheckBoxPage();
    await steps.expandTree();
    await steps.toggle('Home');
    await steps.verifySelected([
      'home',
      'desktop',
      'notes',
      'commands',
      'documents',
      'workspace',
      'react',
      'angular',
      'veu',
      'office',
      'public',
      'private',
      'classified',
      'general',
      'downloads',
      'wordFile',
      'excelFile',
    ]);
  });

  test('Checking only one child leaves the parent in a partial (indeterminate) state', async ({ page }) => {
    const steps = new CheckBoxSteps(page);

    await steps.openCheckBoxPage();
    await steps.expandTree();
    await steps.toggle('Notes');
    await steps.verifySelected(['notes']);
    await steps.verifyParentIndeterminate('Desktop');
  });

  test('Checking every child of a parent marks the parent fully checked, not partial', async ({ page }) => {
    const steps = new CheckBoxSteps(page);

    await steps.openCheckBoxPage();
    await steps.expandTree();
    await steps.toggle('Notes');
    await steps.toggle('Commands');
    await steps.verifySelected(['notes', 'commands']);
    await steps.verifyParentFullyChecked('Desktop');
  });

  test('Unchecking the only selected item removes the result block entirely', async ({ page }) => {
    const steps = new CheckBoxSteps(page);

    await steps.openCheckBoxPage();
    await steps.expandTree();
    await steps.toggle('Notes');
    await steps.verifySelected(['notes']);
    await steps.toggle('Notes');
    await steps.verifyNoSelection();
  });

  test('Checking a deeply nested node cascades a partial state up through every ancestor level', async ({ page }) => {
    const steps = new CheckBoxSteps(page);

    await steps.openCheckBoxPage();
    await steps.expandTree();
    await steps.toggle('React');
    await steps.verifySelected(['react']);
    await steps.verifyParentIndeterminate('WorkSpace');
    await steps.verifyParentIndeterminate('Documents');
  });

  test('Checking two independent subtrees selects both without interfering with each other', async ({ page }) => {
    const steps = new CheckBoxSteps(page);

    await steps.openCheckBoxPage();
    await steps.expandTree();
    await steps.toggle('Desktop');
    await steps.toggle('Word File.doc');
    await steps.verifySelected(['desktop', 'notes', 'commands', 'wordFile']);
    await steps.verifyParentFullyChecked('Desktop');
    await steps.verifyNotSelected(['excelFile', 'downloads', 'documents']);
  });

  test('Unchecking a fully checked parent deselects its entire subtree at once', async ({ page }) => {
    const steps = new CheckBoxSteps(page);

    await steps.openCheckBoxPage();
    await steps.expandTree();
    await steps.toggle('Desktop');
    await steps.verifySelected(['desktop', 'notes', 'commands']);
    await steps.toggle('Desktop');
    await steps.verifyNoSelection();
  });

  test('Collapsing and re-expanding a node does not clear its checked children', async ({ page }) => {
    const steps = new CheckBoxSteps(page);

    await steps.openCheckBoxPage();
    await steps.expandTree();
    await steps.toggle('Notes');
    await steps.verifySelected(['notes']);

    await steps.collapse('Desktop');
    await steps.expand('Desktop');
    await steps.verifySelected(['notes']);
  });
});
