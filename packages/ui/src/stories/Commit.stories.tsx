import type { Meta, StoryObj } from "@storybook/react";
import {
  Commit,
  CommitAuthor,
  CommitAuthorAvatar,
  CommitContent,
  CommitCopyButton,
  CommitFile,
  CommitFileAdditions,
  CommitFileDeletions,
  CommitFileIcon,
  CommitFilePath,
  CommitFiles,
  CommitFileStatus,
  CommitHash,
  CommitHeader,
  CommitInfo,
  CommitTimestamp,
} from "../components/Commit";

const meta = {
  title: "Components/Commit",
  component: Commit,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Commit>;

export default meta;
type Story = StoryObj<typeof meta>;

const NOW = new Date();
const YESTERDAY = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
const LAST_WEEK = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);

export const Default: Story = {
  render: () => (
    <div style={{ width: "36rem" }}>
      <Commit defaultOpen>
        <CommitHeader>
          <CommitAuthor>
            <CommitAuthorAvatar initials="OK" />
            fix(auth): handle expired session tokens
          </CommitAuthor>
          <CommitInfo>
            <CommitHash hash="a1b2c3d4e5f6" />
            <CommitCopyButton hash="a1b2c3d4e5f6" />
            <CommitTimestamp date={YESTERDAY} />
          </CommitInfo>
        </CommitHeader>
        <CommitContent>
          <CommitFiles>
            <CommitFile>
              <CommitFileStatus status="modified" />
              <CommitFileIcon />
              <CommitFilePath>src/auth/session.ts</CommitFilePath>
              <CommitFileAdditions count={24} />
              <CommitFileDeletions count={7} />
            </CommitFile>
            <CommitFile>
              <CommitFileStatus status="added" />
              <CommitFileIcon />
              <CommitFilePath>src/auth/session.test.ts</CommitFilePath>
              <CommitFileAdditions count={48} />
              <CommitFileDeletions count={0} />
            </CommitFile>
            <CommitFile>
              <CommitFileStatus status="deleted" />
              <CommitFileIcon />
              <CommitFilePath>src/auth/legacy.ts</CommitFilePath>
              <CommitFileAdditions count={0} />
              <CommitFileDeletions count={18} />
            </CommitFile>
            <CommitFile>
              <CommitFileStatus status="renamed" />
              <CommitFileIcon />
              <CommitFilePath>src/auth/utils.ts → src/auth/helpers.ts</CommitFilePath>
              <CommitFileAdditions count={2} />
              <CommitFileDeletions count={2} />
            </CommitFile>
          </CommitFiles>
        </CommitContent>
      </Commit>
    </div>
  ),
};

export const Collapsed: Story = {
  render: () => (
    <div style={{ width: "36rem" }}>
      <Commit>
        <CommitHeader>
          <CommitAuthor>
            <CommitAuthorAvatar initials="JS" />
            feat: add dark mode support
          </CommitAuthor>
          <CommitInfo>
            <CommitHash hash="b2c3d4e5f6a7" />
            <CommitCopyButton hash="b2c3d4e5f6a7" />
            <CommitTimestamp date={LAST_WEEK} />
          </CommitInfo>
        </CommitHeader>
        <CommitContent>
          <CommitFiles>
            <CommitFile>
              <CommitFileStatus status="modified" />
              <CommitFileIcon />
              <CommitFilePath>src/theme.css</CommitFilePath>
              <CommitFileAdditions count={12} />
              <CommitFileDeletions count={0} />
            </CommitFile>
          </CommitFiles>
        </CommitContent>
      </Commit>
    </div>
  ),
};
