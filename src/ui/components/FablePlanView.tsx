import React, { useContext, useState } from 'react';
import { Box, Text, useInput } from 'ink';

import { SettingsContext } from '../App';
import { FablePlanConfig, RouterEffort } from '../../types';
import { DEFAULT_SETTINGS } from '../../defaultSettings';

const MODELS: FablePlanConfig['planModel'][] = [
  'fable',
  'opus',
  'sonnet',
  'haiku',
];
const EFFORTS: RouterEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

const label = (alias: string): string =>
  alias.charAt(0).toUpperCase() + alias.slice(1);

type Row =
  | { kind: 'enabled' }
  | { kind: 'model'; side: 'plan' | 'exec' }
  | { kind: 'effort'; side: 'plan' | 'exec' }
  | { kind: 'clearContext' };

const ROWS: Row[] = [
  { kind: 'enabled' },
  { kind: 'model', side: 'plan' },
  { kind: 'effort', side: 'plan' },
  { kind: 'model', side: 'exec' },
  { kind: 'effort', side: 'exec' },
  { kind: 'clearContext' },
];

export const FablePlanView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { settings, updateSettings } = useContext(SettingsContext);
  // Always read through a fully-defaulted copy, so a config written before this
  // block existed still renders sane values.
  const fablePlan: FablePlanConfig = {
    ...DEFAULT_SETTINGS.fablePlan,
    ...(settings.fablePlan ?? {}),
  };
  const [index, setIndex] = useState(0);

  const update = (patch: Partial<FablePlanConfig>): void => {
    updateSettings(s => ({
      ...s,
      fablePlan: {
        ...DEFAULT_SETTINGS.fablePlan,
        ...(s.fablePlan ?? {}),
        ...patch,
      },
    }));
  };

  // Left/right cycles the focused row's value. Model and effort are small closed
  // sets, so a picker sub-view would be more chrome than the choice deserves.
  const cycle = (delta: number): void => {
    const row = ROWS[index];
    if (row.kind === 'enabled') {
      update({ enabled: !fablePlan.enabled });
      return;
    }
    if (row.kind === 'clearContext') {
      update({
        offerClearContextOnPlanAccept: !fablePlan.offerClearContextOnPlanAccept,
      });
      return;
    }
    if (row.kind === 'model') {
      const key = row.side === 'plan' ? 'planModel' : 'execModel';
      const other =
        row.side === 'plan' ? fablePlan.execModel : fablePlan.planModel;
      const from = MODELS.indexOf(fablePlan[key]);
      // Skip the other side's model: pairing a model with itself is not a
      // pairing, and the patch refuses it rather than emitting a no-op alias.
      for (let step = 1; step <= MODELS.length; step++) {
        const next =
          MODELS[(from + delta * step + MODELS.length * step) % MODELS.length];
        if (next !== other) {
          update({ [key]: next } as Partial<FablePlanConfig>);
          return;
        }
      }
      return;
    }
    const key = row.side === 'plan' ? 'planEffort' : 'execEffort';
    const from = EFFORTS.indexOf(fablePlan[key]);
    const next = EFFORTS[(from + delta + EFFORTS.length) % EFFORTS.length];
    update({ [key]: next } as Partial<FablePlanConfig>);
  };

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      onBack();
      return;
    }
    if (key.upArrow) setIndex(i => (i - 1 + ROWS.length) % ROWS.length);
    else if (key.downArrow) setIndex(i => (i + 1) % ROWS.length);
    else if (key.leftArrow) cycle(-1);
    else if (key.rightArrow || key.return || input === ' ') cycle(1);
    else if (input === 'x') update({ ...DEFAULT_SETTINGS.fablePlan });
  });

  const row = (i: number, name: string, value: string): React.ReactElement => (
    <Box key={name}>
      <Text color={i === index ? 'cyan' : undefined}>
        {i === index ? '❯ ' : '  '}
        {name.padEnd(26)}
      </Text>
      <Text color={i === index ? 'cyan' : 'green'} bold={i === index}>
        {value}
      </Text>
    </Box>
  );

  const alias = `${fablePlan.planModel}plan`;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Fable Plan mode</Text>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          Adds a <Text color="green">{alias}</Text> entry to Claude Code&apos;s{' '}
          <Text color="green">/model</Text> list: {label(fablePlan.planModel)}{' '}
          while planning, {label(fablePlan.execModel)} while executing, each at
          its own reasoning effort.
        </Text>
        <Text dimColor>
          It is a model you select, the same mechanism Claude Code ships for
          opusplan. Nothing changes for any other model, and your selection
          stays <Text color="green">{alias}</Text> throughout — the pairing is
          resolved per request, so no model is ever switched underneath you
          mid-session.
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {ROWS.map((r, i) => {
          if (r.kind === 'enabled') {
            return row(i, 'Enabled', fablePlan.enabled ? 'yes' : 'no');
          }
          if (r.kind === 'clearContext') {
            return row(
              i,
              'Offer "clear context"',
              fablePlan.offerClearContextOnPlanAccept ? 'yes' : 'no'
            );
          }
          const side = r.side === 'plan' ? 'Planning' : 'Executing';
          if (r.kind === 'model') {
            return row(
              i,
              `${side} model`,
              label(
                r.side === 'plan' ? fablePlan.planModel : fablePlan.execModel
              )
            );
          }
          return row(
            i,
            `${side} effort`,
            r.side === 'plan' ? fablePlan.planEffort : fablePlan.execEffort
          );
        })}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          Claude Code defaults its &quot;clear context&quot; option off. On, the
          plan-approval dialog offers &quot;Yes, clear context (N% used)&quot;,
          which hands only the plan to {label(fablePlan.execModel)}. Continuing
          instead re-sends the whole planning transcript to a different model,
          so the cache is cold either way and you pay for the transcript twice.
        </Text>
        <Text dimColor>
          Effort follows the resolved model, so the complexity router still
          drives every model that is not part of this pairing.
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ move · ←→ change · x reset to defaults · esc back
        </Text>
      </Box>
    </Box>
  );
};
