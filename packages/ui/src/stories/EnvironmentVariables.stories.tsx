import type { Meta, StoryObj } from "@storybook/react";
import {
  EnvironmentVariable,
  EnvironmentVariableCopyButton,
  EnvironmentVariableGroup,
  EnvironmentVariableName,
  EnvironmentVariableRequired,
  EnvironmentVariableValue,
  EnvironmentVariables,
  EnvironmentVariablesContent,
  EnvironmentVariablesHeader,
  EnvironmentVariablesTitle,
  EnvironmentVariablesToggle,
} from "../components/EnvironmentVariables";

const meta = {
  title: "Components/EnvironmentVariables",
  component: EnvironmentVariables,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof EnvironmentVariables>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div style={{ width: "36rem" }}>
      <EnvironmentVariables>
        <EnvironmentVariablesHeader>
          <EnvironmentVariablesTitle>Production environment</EnvironmentVariablesTitle>
          <EnvironmentVariablesToggle />
        </EnvironmentVariablesHeader>
        <EnvironmentVariablesContent>
          <EnvironmentVariable
            name="DATABASE_URL"
            value="postgres://user:pass@db.example.com:5432/app"
          >
            <EnvironmentVariableName />
            <EnvironmentVariableValue />
            <EnvironmentVariableRequired />
            <EnvironmentVariableCopyButton format="export" />
          </EnvironmentVariable>
          <EnvironmentVariable name="REDIS_URL" value="redis://redis.example.com:6379">
            <EnvironmentVariableName />
            <EnvironmentVariableValue />
            <EnvironmentVariableRequired />
            <EnvironmentVariableCopyButton format="value" />
          </EnvironmentVariable>
          <EnvironmentVariable name="LOG_LEVEL" value="info">
            <EnvironmentVariableName />
            <EnvironmentVariableValue />
            <EnvironmentVariableCopyButton format="value" />
          </EnvironmentVariable>
          <EnvironmentVariable name="API_KEY" value="sk_live_51abc123def456ghi789jkl">
            <EnvironmentVariableName />
            <EnvironmentVariableValue />
            <EnvironmentVariableRequired />
            <EnvironmentVariableCopyButton format="value" />
          </EnvironmentVariable>
        </EnvironmentVariablesContent>
      </EnvironmentVariables>
    </div>
  ),
};

export const Grouped: Story = {
  render: () => (
    <div style={{ width: "36rem" }}>
      <EnvironmentVariables defaultShowValues>
        <EnvironmentVariablesHeader>
          <EnvironmentVariablesTitle>Environment</EnvironmentVariablesTitle>
          <EnvironmentVariablesToggle />
        </EnvironmentVariablesHeader>
        <EnvironmentVariablesContent>
          <EnvironmentVariableGroup label="Database">
            <EnvironmentVariable name="DATABASE_URL" value="postgres://localhost/app">
              <EnvironmentVariableName />
              <EnvironmentVariableValue />
              <EnvironmentVariableRequired />
              <EnvironmentVariableCopyButton />
            </EnvironmentVariable>
            <EnvironmentVariable name="DATABASE_POOL_SIZE" value="20">
              <EnvironmentVariableName />
              <EnvironmentVariableValue />
              <EnvironmentVariableCopyButton />
            </EnvironmentVariable>
          </EnvironmentVariableGroup>
          <EnvironmentVariableGroup label="Auth">
            <EnvironmentVariable name="JWT_SECRET" value="secret-abc-123-def-456">
              <EnvironmentVariableName />
              <EnvironmentVariableValue />
              <EnvironmentVariableRequired />
              <EnvironmentVariableCopyButton />
            </EnvironmentVariable>
          </EnvironmentVariableGroup>
        </EnvironmentVariablesContent>
      </EnvironmentVariables>
    </div>
  ),
};
