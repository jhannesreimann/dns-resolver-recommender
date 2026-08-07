import os
import sys
from selenium import webdriver
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

URL = os.getenv("MEASUREMENT_URL", "https://dns.diic-hpi.org")
TIMEOUT = int(os.getenv("MEASUREMENT_TIMEOUT", "900"))


def create_driver():
    options = Options()
    options.add_argument("-headless")
    options.binary_location = "/usr/bin/firefox-esr"

    service = Service(
        executable_path="/usr/local/bin/geckodriver",
        log_output=sys.stdout,
    )

    return webdriver.Firefox(
        service=service,
        options=options,
    )


def install_console_hook(driver):
    driver.execute_script("""
        if (!window.__seleniumConsoleLogs) {
            window.__seleniumConsoleLogs = [];

            const originalLog = console.log;

            console.log = function (...args) {
                const msg = args.map(String).join(" ");
                window.__seleniumConsoleLogs.push(msg);
                originalLog.apply(console, args);
            };
        }
    """)


def wait_for_console_message(driver, message, timeout):
    WebDriverWait(driver, timeout, poll_frequency=0.5).until(
        lambda d: d.execute_script(
            """
            return window.__seleniumConsoleLogs &&
                   window.__seleniumConsoleLogs.includes(arguments[0]);
            """,
            message,
        )
    )


def click_opt_in(driver):
    xpath = (
        "//*["
        "self::button or "
        "self::label or "
        "@role='button' or "
        "@role='checkbox' or "
        "@role='switch'"
        "]["
        "contains(translate(normalize-space(.),"
        "'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),"
        "'opt-in')"
        " or "
        "contains(translate(normalize-space(.),"
        "'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),"
        "'opt in')"
        " or "
        "contains(translate(normalize-space(.),"
        "'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),"
        "'anonymized')"
        "]"
    )

    element = WebDriverWait(driver, 30).until(
        EC.element_to_be_clickable((By.XPATH, xpath))
    )

    element.click()


def click_start_measurement(driver):
    xpath = (
        "//*["
        "self::button or @role='button'"
        "]["
        "contains(translate(normalize-space(.),"
        "'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),"
        "'start measurement')"
        "]"
    )

    button = WebDriverWait(driver, 30).until(
        EC.element_to_be_clickable((By.XPATH, xpath))
    )

    button.click()


def main():
    driver = create_driver()

    try:
        print(f"Opening {URL}")

        driver.get(URL)

        WebDriverWait(driver, 30).until(
            lambda d: d.execute_script(
                "return document.readyState"
            ) == "complete"
        )

        install_console_hook(driver)

        print("Clicking Opt-In...")
        click_opt_in(driver)

        print("Clicking Start Measurement...")
        click_start_measurement(driver)

        print("Waiting for measurement to start...")

        wait_for_console_message(
            driver,
            "[STATUS] Measurement started",
            30,
        )

        print("Measurement started.")

        print("Waiting for measurement to finish...")

        wait_for_console_message(
            driver,
            "[STATUS] Measurement Finished",
            TIMEOUT,
        )

        print("Measurement finished successfully.")

    except TimeoutException as e:
        print(f"Timeout: {e}", file=sys.stderr)
        sys.exit(1)

    finally:
        driver.quit()


if __name__ == "__main__":
    main()
