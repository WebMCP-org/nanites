import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Form } from "../components/Form";
import { Field } from "../components/Field";
import { Button } from "../components/Button";

const meta = {
  title: "Components/Form",
  component: Form,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Form>;

export default meta;
type Story = StoryObj<typeof meta>;

function handleDefaultSubmit(values: Record<string, FormDataEntryValue>) {
  console.log("Form submitted:", values);
  alert(`Submitted: ${JSON.stringify(values, null, 2)}`);
}

function handleWithValidationSubmit(values: Record<string, FormDataEntryValue>) {
  console.log("Form submitted:", values);
  alert(`Account created for: ${values.email as string}`);
}

function handleValidateOnBlurSubmit(values: Record<string, FormDataEntryValue>) {
  console.log("Form submitted:", values);
}

function handleValidateOnChangeSubmit(values: Record<string, FormDataEntryValue>) {
  console.log("Form submitted:", values);
}

function handleCustomValidationSubmit(values: Record<string, FormDataEntryValue>) {
  console.log("Form submitted:", values);
  alert("Passwords match! Form submitted.");
}

export const Default: Story = {
  render: () => {
    return (
      <Form onSubmit={handleDefaultSubmit} style={{ width: "320px" }}>
        <Field.Root name="name">
          <Field.Label>Name</Field.Label>
          <Field.Control required placeholder="Enter your name" />
          <Field.Error match="valueMissing">Name is required</Field.Error>
        </Field.Root>

        <Button type="submit" color="primary">
          Submit
        </Button>
      </Form>
    );
  },
};

export const WithValidation: Story = {
  render: () => {
    return (
      <Form onSubmit={handleWithValidationSubmit} style={{ width: "320px" }}>
        <Field.Root name="name">
          <Field.Label>
            Name <span style={{ color: "hsl(var(--destructive))" }}>*</span>
          </Field.Label>
          <Field.Control required placeholder="John Doe" />
          <Field.Error match="valueMissing">Name is required</Field.Error>
        </Field.Root>

        <Field.Root name="email">
          <Field.Label>
            Email <span style={{ color: "hsl(var(--destructive))" }}>*</span>
          </Field.Label>
          <Field.Control type="email" required placeholder="john@example.com" />
          <Field.Error match="valueMissing">Email is required</Field.Error>
          <Field.Error match="typeMismatch">Please enter a valid email</Field.Error>
        </Field.Root>

        <Field.Root name="company">
          <Field.Label>Company</Field.Label>
          <Field.Control placeholder="Acme Inc." />
          <Field.Description>Optional</Field.Description>
        </Field.Root>

        <Field.Root name="password">
          <Field.Label>
            Password <span style={{ color: "hsl(var(--destructive))" }}>*</span>
          </Field.Label>
          <Field.Control
            type="password"
            required
            minLength={8}
            placeholder="At least 8 characters"
          />
          <Field.Error match="valueMissing">Password is required</Field.Error>
          <Field.Error match="tooShort">Password must be at least 8 characters</Field.Error>
        </Field.Root>

        <Button type="submit" color="primary" style={{ marginTop: "0.5rem" }}>
          Create Account
        </Button>
      </Form>
    );
  },
};

export const ValidateOnBlur: Story = {
  render: () => {
    return (
      <Form
        onSubmit={handleValidateOnBlurSubmit}
        validationMode="onBlur"
        style={{ width: "320px" }}
      >
        <Field.Root name="username">
          <Field.Label>Username</Field.Label>
          <Field.Control required minLength={3} placeholder="At least 3 chars" />
          <Field.Error match="valueMissing">Username is required</Field.Error>
          <Field.Error match="tooShort">Username must be at least 3 characters</Field.Error>
          <Field.Description>Validation triggers when you leave the field</Field.Description>
        </Field.Root>

        <Field.Root name="email">
          <Field.Label>Email</Field.Label>
          <Field.Control type="email" required placeholder="you@example.com" />
          <Field.Error match="valueMissing">Email is required</Field.Error>
          <Field.Error match="typeMismatch">Invalid email format</Field.Error>
        </Field.Root>

        <Button type="submit" color="primary">
          Submit
        </Button>
      </Form>
    );
  },
};

export const ValidateOnChange: Story = {
  render: () => {
    return (
      <Form
        onSubmit={handleValidateOnChangeSubmit}
        validationMode="onChange"
        style={{ width: "320px" }}
      >
        <Field.Root name="username" validationDebounceTime={300}>
          <Field.Label>Username</Field.Label>
          <Field.Control required minLength={3} placeholder="At least 3 chars" />
          <Field.Error match="valueMissing">Username is required</Field.Error>
          <Field.Error match="tooShort">Username must be at least 3 characters</Field.Error>
          <Field.Description>Validation triggers as you type (debounced)</Field.Description>
        </Field.Root>

        <Button type="submit" color="primary">
          Submit
        </Button>
      </Form>
    );
  },
};

export const WithServerErrors: Story = {
  render: function WithServerErrors() {
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (values: Record<string, FormDataEntryValue>) => {
      setErrors({});
      setIsSubmitting(true);

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Simulate server validation errors
      const serverErrors: Record<string, string> = {};

      if (values.username === "admin") {
        serverErrors.username = "This username is already taken";
      }

      if (values.email === "test@example.com") {
        serverErrors.email = "This email is already registered";
      }

      setIsSubmitting(false);

      if (Object.keys(serverErrors).length > 0) {
        setErrors(serverErrors);
      } else {
        alert("Registration successful!");
      }
    };

    return (
      <Form onSubmit={handleSubmit} errors={errors} style={{ width: "320px" }}>
        <Field.Root name="username">
          <Field.Label>Username</Field.Label>
          <Field.Control required placeholder="Choose a username" />
          <Field.Error match="valueMissing">Username is required</Field.Error>
          <Field.Error />
          <Field.Description>Try "admin" to see server error</Field.Description>
        </Field.Root>

        <Field.Root name="email">
          <Field.Label>Email</Field.Label>
          <Field.Control type="email" required placeholder="you@example.com" />
          <Field.Error match="valueMissing">Email is required</Field.Error>
          <Field.Error match="typeMismatch">Invalid email format</Field.Error>
          <Field.Error />
          <Field.Description>Try "test@example.com" to see server error</Field.Description>
        </Field.Root>

        <Button type="submit" color="primary" disabled={isSubmitting}>
          {isSubmitting ? "Registering..." : "Register"}
        </Button>
      </Form>
    );
  },
};

export const CustomValidation: Story = {
  render: () => {
    return (
      <Form onSubmit={handleCustomValidationSubmit} style={{ width: "320px" }}>
        <Field.Root name="password">
          <Field.Label>Password</Field.Label>
          <Field.Control type="password" required minLength={8} placeholder="Enter password" />
          <Field.Error match="valueMissing">Password is required</Field.Error>
          <Field.Error match="tooShort">Password must be at least 8 characters</Field.Error>
        </Field.Root>

        <Field.Root
          name="confirmPassword"
          validate={(value, formValues) => {
            if (value !== formValues.password) {
              return "Passwords do not match";
            }
            return null;
          }}
        >
          <Field.Label>Confirm Password</Field.Label>
          <Field.Control type="password" required placeholder="Confirm password" />
          <Field.Error match="valueMissing">Please confirm your password</Field.Error>
          <Field.Error />
        </Field.Root>

        <Button type="submit" color="primary">
          Set Password
        </Button>
      </Form>
    );
  },
};

export const ContactForm: Story = {
  render: function ContactForm() {
    const [submitted, setSubmitted] = useState(false);

    const handleSubmit = (values: Record<string, FormDataEntryValue>) => {
      console.log("Contact form submitted:", values);
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 3000);
    };

    return (
      <Form onSubmit={handleSubmit} style={{ width: "360px" }}>
        <div style={{ display: "flex", gap: "1rem" }}>
          <Field.Root name="firstName" style={{ flex: 1 }}>
            <Field.Label>First Name</Field.Label>
            <Field.Control required placeholder="John" />
            <Field.Error match="valueMissing">Required</Field.Error>
          </Field.Root>

          <Field.Root name="lastName" style={{ flex: 1 }}>
            <Field.Label>Last Name</Field.Label>
            <Field.Control required placeholder="Doe" />
            <Field.Error match="valueMissing">Required</Field.Error>
          </Field.Root>
        </div>

        <Field.Root name="email">
          <Field.Label>Email</Field.Label>
          <Field.Control type="email" required placeholder="john@example.com" />
          <Field.Error match="valueMissing">Email is required</Field.Error>
          <Field.Error match="typeMismatch">Invalid email format</Field.Error>
        </Field.Root>

        <Field.Root name="subject">
          <Field.Label>Subject</Field.Label>
          <Field.Control required placeholder="How can we help?" />
          <Field.Error match="valueMissing">Subject is required</Field.Error>
        </Field.Root>

        <Field.Root name="message">
          <Field.Label>Message</Field.Label>
          <Field.Control
            render={<textarea rows={4} style={{ resize: "vertical" }} />}
            required
            placeholder="Tell us more..."
          />
          <Field.Error match="valueMissing">Message is required</Field.Error>
        </Field.Root>

        <Button type="submit" color="primary" style={{ alignSelf: "flex-start" }}>
          {submitted ? "Message Sent!" : "Send Message"}
        </Button>
      </Form>
    );
  },
};
