import type { Meta, StoryObj } from "@storybook/react";
import { expect, screen, userEvent, within } from "storybook/test";
import { Toast } from "../components/Toast";
import { Button } from "../components/Button";

const meta = {
  title: "Components/Toast",
  component: Toast.Provider,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Toast.Provider timeout={5000} limit={5}>
        <Story />
        <ToastViewport />
      </Toast.Provider>
    ),
  ],
} satisfies Meta<typeof Toast.Provider>;

export default meta;
type Story = StoryObj<typeof meta>;

function ToastViewport() {
  const { toasts } = Toast.useToastManager();

  return (
    <Toast.Viewport>
      {toasts.map((toast) => (
        <Toast.Root key={toast.id} toast={toast} style={{ position: "relative" }}>
          <Toast.Content>
            {toast.title && <Toast.Title>{toast.title}</Toast.Title>}
            {toast.description && <Toast.Description>{toast.description}</Toast.Description>}
          </Toast.Content>
          <Toast.Close aria-label="Dismiss">×</Toast.Close>
        </Toast.Root>
      ))}
    </Toast.Viewport>
  );
}

export const Default: Story = {
  render: function Default() {
    const toastManager = Toast.useToastManager();

    return (
      <Button
        onClick={() =>
          toastManager.add({
            title: "Notification",
            description: "This is a toast notification.",
          })
        }
      >
        Show Toast
      </Button>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("Show Toast"));
    await expect(await screen.findByText("Notification")).toBeInTheDocument();
    await expect(screen.getByText("This is a toast notification.")).toBeInTheDocument();
  },
};

export const WithTitle: Story = {
  render: function WithTitle() {
    const toastManager = Toast.useToastManager();

    return (
      <Button
        onClick={() =>
          toastManager.add({
            title: "Changes Saved",
            description: "Your profile has been updated successfully.",
          })
        }
      >
        Show Toast with Title
      </Button>
    );
  },
};

export const DescriptionOnly: Story = {
  render: function DescriptionOnly() {
    const toastManager = Toast.useToastManager();

    return (
      <Button
        onClick={() =>
          toastManager.add({
            description: "Item added to cart.",
          })
        }
      >
        Show Simple Toast
      </Button>
    );
  },
};

export const ToastTypes: Story = {
  render: function ToastTypes() {
    const toastManager = Toast.useToastManager();

    return (
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <Button
          color="neutral"
          onClick={() =>
            toastManager.add({
              type: "info",
              title: "Information",
              description: "Here's some helpful information.",
            })
          }
        >
          Info
        </Button>
        <Button
          color="primary"
          onClick={() =>
            toastManager.add({
              type: "success",
              title: "Success",
              description: "Operation completed successfully.",
            })
          }
        >
          Success
        </Button>
        <Button
          color="neutral"
          onClick={() =>
            toastManager.add({
              type: "warning",
              title: "Warning",
              description: "Please review before proceeding.",
            })
          }
        >
          Warning
        </Button>
        <Button
          color="destructive"
          onClick={() =>
            toastManager.add({
              type: "error",
              title: "Error",
              description: "Something went wrong. Please try again.",
            })
          }
        >
          Error
        </Button>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("Info"));
    await expect(await screen.findByText("Here's some helpful information.")).toBeInTheDocument();
    await userEvent.click(canvas.getByText("Error"));
    await expect(
      await screen.findByText("Something went wrong. Please try again."),
    ).toBeInTheDocument();
  },
};

export const CustomTimeout: Story = {
  render: function CustomTimeout() {
    const toastManager = Toast.useToastManager();

    return (
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <Button
          onClick={() =>
            toastManager.add({
              title: "Quick Toast",
              description: "Disappears in 2 seconds.",
              timeout: 2000,
            })
          }
        >
          2s Toast
        </Button>
        <Button
          onClick={() =>
            toastManager.add({
              title: "Long Toast",
              description: "Stays for 10 seconds.",
              timeout: 10000,
            })
          }
        >
          10s Toast
        </Button>
      </div>
    );
  },
};

export const MultipleToasts: Story = {
  render: function MultipleToasts() {
    const toastManager = Toast.useToastManager();

    const showMultiple = () => {
      toastManager.add({
        type: "info",
        title: "Step 1",
        description: "Processing your request...",
      });
      setTimeout(() => {
        toastManager.add({
          type: "info",
          title: "Step 2",
          description: "Validating data...",
        });
      }, 500);
      setTimeout(() => {
        toastManager.add({
          type: "success",
          title: "Complete",
          description: "All steps completed successfully!",
        });
      }, 1000);
    };

    return <Button onClick={showMultiple}>Show Multiple Toasts</Button>;
  },
};

export const WithAction: Story = {
  render: function WithAction() {
    const { toasts } = Toast.useToastManager();
    const toastManager = Toast.useToastManager();

    return (
      <>
        <Button
          onClick={() =>
            toastManager.add({
              title: "File Deleted",
              description: "document.pdf has been deleted.",
              data: { canUndo: true },
            })
          }
        >
          Delete File
        </Button>

        <Toast.Viewport aria-label="Action notifications">
          {toasts.map((toast) => (
            <Toast.Root key={toast.id} toast={toast} style={{ position: "relative" }}>
              <Toast.Content>
                {toast.title && <Toast.Title>{toast.title}</Toast.Title>}
                {toast.description && <Toast.Description>{toast.description}</Toast.Description>}
                {toast.data?.canUndo && (
                  <Toast.Action onClick={() => console.log("Undo clicked")}>Undo</Toast.Action>
                )}
              </Toast.Content>
              <Toast.Close aria-label="Dismiss">×</Toast.Close>
            </Toast.Root>
          ))}
        </Toast.Viewport>
      </>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("Delete File"));

    await expect(await screen.findByText("Undo")).toBeInTheDocument();
  },
};

export const ProgrammaticDismiss: Story = {
  render: function ProgrammaticDismiss() {
    const toastManager = Toast.useToastManager();

    return (
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <Button
          onClick={() =>
            toastManager.add({
              id: "persistent",
              title: "Persistent Toast",
              description: "Click the other button to dismiss this.",
              timeout: 0, // Never auto-dismiss
            })
          }
        >
          Show Persistent Toast
        </Button>
        <Button color="neutral" onClick={() => toastManager.close("persistent")}>
          Dismiss Toast
        </Button>
      </div>
    );
  },
};
