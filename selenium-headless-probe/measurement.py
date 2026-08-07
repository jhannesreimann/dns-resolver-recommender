import json
import os
import sys
import time
from pathlib import Path

from selenium import webdriver
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait


URL = os.getenv(
    "MEASUREMENT_URL",
    "https://dns.diic-hpi.org",
)

TIMEOUT = int(
    os.getenv(
        "MEASUREMENT_TIMEOUT",
        "900",
    )
)

OUTPUT_DIR = Path(
    os.getenv(
        "OUTPUT_DIR",
        "/app/output",
    )
)


def save_screenshot(driver, filename):
    OUTPUT_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    path = OUTPUT_DIR / filename
    driver.save_screenshot(str(path))

    print(
        f"Screenshot saved to {path}",
        flush=True,
    )


def dump_page_source(driver, filename):
    OUTPUT_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    path = OUTPUT_DIR / filename

    path.write_text(
        driver.page_source,
        encoding="utf-8",
    )

    print(
        f"Page source saved to {path}",
        flush=True,
    )


def dump_diagnostics(driver):
    OUTPUT_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    try:
        errors = driver.execute_script(
            """
            return window.__seleniumErrors || [];
            """
        )
    except Exception:
        errors = []

    try:
        interactive_elements = driver.execute_script(
            """
            return [
                ...document.querySelectorAll(
                    'button, input, label, ' +
                    '[role="button"], ' +
                    '[role="checkbox"], ' +
                    '[role="switch"]'
                )
            ].map((element, index) => ({
                index,
                tag: element.tagName,
                type: element.getAttribute("type"),
                role: element.getAttribute("role"),
                id: element.id,
                name: element.getAttribute("name"),
                text: (
                    element.innerText ||
                    element.textContent ||
                    element.value ||
                    ""
                ).trim(),
                ariaLabel: element.getAttribute("aria-label"),
                disabled: Boolean(element.disabled),
                displayed: Boolean(
                    element.offsetWidth ||
                    element.offsetHeight ||
                    element.getClientRects().length
                )
            }));
            """
        )
    except Exception:
        interactive_elements = []

    diagnostics = {
        "url": driver.current_url,
        "title": driver.title,
        "readyState": driver.execute_script(
            "return document.readyState;"
        ),
        "userAgent": driver.execute_script(
            "return navigator.userAgent;"
        ),
        "javascriptErrors": errors,
        "interactiveElements": interactive_elements,
    }

    path = OUTPUT_DIR / "diagnostics.json"

    path.write_text(
        json.dumps(
            diagnostics,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(
        json.dumps(
            diagnostics,
            indent=2,
        ),
        file=sys.stderr,
        flush=True,
    )

    print(
        f"Diagnostics saved to {path}",
        flush=True,
    )


def install_error_recorder(driver):
    driver.execute_script(
        """
        window.__seleniumErrors = [];

        window.addEventListener("error", event => {
            window.__seleniumErrors.push({
                type: "error",
                message: event.message || String(event.error),
                source: event.filename || "",
                line: event.lineno || 0,
                column: event.colno || 0
            });
        });

        window.addEventListener(
            "unhandledrejection",
            event => {
                window.__seleniumErrors.push({
                    type: "unhandledrejection",
                    message: String(event.reason)
                });
            }
        );
        """
    )


def application_is_ready(driver):
    return driver.execute_script(
        """
        const elements = [
            ...document.querySelectorAll(
                'button, input, label, ' +
                '[role="button"], ' +
                '[role="checkbox"], ' +
                '[role="switch"]'
            )
        ];

        return elements.some(element => {
            const text = [
                element.innerText,
                element.textContent,
                element.value,
                element.getAttribute("aria-label")
            ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

            return (
                text.includes("start measurement") ||
                text.includes("opt-in") ||
                text.includes("opt in") ||
                text.includes("anonymized")
            );
        });
        """
    )


def click_opt_in(driver):
    print(
        "Looking for opt-in control...",
        flush=True,
    )

    xpath = (
        "//*["
        "self::button or "
        "self::label or "
        "@role='button' or "
        "@role='checkbox' or "
        "@role='switch'"
        "]["
        "contains("
        "translate(normalize-space(.), "
        "'ABCDEFGHIJKLMNOPQRSTUVWXYZ', "
        "'abcdefghijklmnopqrstuvwxyz'), "
        "'opt-in'"
        ") or "
        "contains("
        "translate(normalize-space(.), "
        "'ABCDEFGHIJKLMNOPQRSTUVWXYZ', "
        "'abcdefghijklmnopqrstuvwxyz'), "
        "'opt in'"
        ") or "
        "contains("
        "translate(normalize-space(.), "
        "'ABCDEFGHIJKLMNOPQRSTUVWXYZ', "
        "'abcdefghijklmnopqrstuvwxyz'), "
        "'anonymized'"
        ")"
        "]"
    )

    try:
        element = WebDriverWait(
            driver,
            30,
        ).until(
            EC.element_to_be_clickable(
                (
                    By.XPATH,
                    xpath,
                )
            )
        )

    except TimeoutException:
        dump_diagnostics(driver)
        save_screenshot(
            driver,
            "opt-in-error.png",
        )

        raise TimeoutException(
            "Could not find the opt-in control."
        )

    driver.execute_script(
        """
        arguments[0].scrollIntoView({
            block: "center"
        });
        """,
        element,
    )

    try:
        element.click()
    except Exception:
        driver.execute_script(
            "arguments[0].click();",
            element,
        )

    print(
        "Opt-in selected.",
        flush=True,
    )


def click_start_measurement(driver):
    print(
        "Looking for Start Measurement button...",
        flush=True,
    )

    xpath = (
        "//*["
        "self::button or "
        "@role='button'"
        "]["
        "contains("
        "translate(normalize-space(.), "
        "'ABCDEFGHIJKLMNOPQRSTUVWXYZ', "
        "'abcdefghijklmnopqrstuvwxyz'), "
        "'start measurement'"
        ")"
        "]"
    )

    try:
        button = WebDriverWait(
            driver,
            30,
        ).until(
            EC.element_to_be_clickable(
                (
                    By.XPATH,
                    xpath,
                )
            )
        )

    except TimeoutException:
        dump_diagnostics(driver)
        save_screenshot(
            driver,
            "start-button-error.png",
        )

        raise TimeoutException(
            "Could not find the 'Start Measurement' button."
        )

    driver.execute_script(
        """
        arguments[0].scrollIntoView({
            block: "center"
        });
        """,
        button,
    )

    try:
        button.click()
    except Exception:
        driver.execute_script(
            "arguments[0].click();",
            button,
        )

    print(
        "Measurement started.",
        flush=True,
    )


def measurement_finished(driver):
    return driver.execute_script(
        """
        const visible = element => {
            if (!element) {
                return false;
            }

            const style = window.getComputedStyle(element);

            return (
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                style.opacity !== "0" &&
                element.getClientRects().length > 0
            );
        };

        const text =
            document.body.innerText.toLowerCase();

        const completionPhrases = [
            "measurement completed",
            "measurement complete",
            "measurement finished",
            "results are ready",
            "recommended resolver",
            "measurement results"
        ];

        if (
            completionPhrases.some(
                phrase => text.includes(phrase)
            )
        ) {
            return true;
        }

        const progressElements = [
            ...document.querySelectorAll(
                '[role="progressbar"], ' +
                'progress, ' +
                '[class*="progress"], ' +
                '[class*="loading"], ' +
                '[class*="spinner"], ' +
                '[aria-busy="true"]'
            )
        ].filter(visible);

        const resultElements = [
            ...document.querySelectorAll(
                '[data-testid*="result"], ' +
                '[data-testid*="recommend"], ' +
                '[class*="result"], ' +
                '[class*="recommend"], ' +
                '[id*="result"], ' +
                'table tbody tr'
            )
        ].filter(element => {
            return (
                visible(element) &&
                (
                    element.innerText || ""
                ).trim().length > 0
            );
        });

        return (
            progressElements.length === 0 &&
            resultElements.length > 0
        );
        """
    )


def wait_for_measurement(driver):
    print(
        f"Waiting up to {TIMEOUT} seconds "
        "for measurement completion...",
        flush=True,
    )

    started_at = time.monotonic()

    while True:
        elapsed = time.monotonic() - started_at

        if measurement_finished(driver):
            print(
                f"Measurement completed after "
                f"{elapsed:.0f} seconds.",
                flush=True,
            )
            return

        if elapsed >= TIMEOUT:
            dump_diagnostics(driver)
            dump_page_source(
                driver,
                "measurement-timeout.html",
            )
            save_screenshot(
                driver,
                "measurement-timeout.png",
            )

            raise TimeoutException(
                f"Measurement did not finish "
                f"within {TIMEOUT} seconds."
            )

        if int(elapsed) % 10 == 0:
            print(
                f"Measurement still running: "
                f"{elapsed:.0f}s",
                flush=True,
            )

        time.sleep(1)


def create_driver():
    options = Options()

    options.add_argument(
        "-headless"
    )

    options.binary_location = (
        "/usr/bin/firefox-esr"
    )

    #
    # Disable unnecessary Firefox services.
    #
    options.set_preference(
        "browser.shell.checkDefaultBrowser",
        False,
    )

    options.set_preference(
        "browser.startup.page",
        0,
    )

    options.set_preference(
        "browser.newtabpage.enabled",
        False,
    )

    options.set_preference(
        "browser.newtabpage.activity-stream.enabled",
        False,
    )

    options.set_preference(
        "browser.newtabpage.activity-stream.feeds.system.topsites",
        False,
    )

    options.set_preference(
        "browser.newtabpage.activity-stream.feeds.topsites",
        False,
    )

    options.set_preference(
        "browser.newtabpage.activity-stream.feeds.telemetry",
        False,
    )

    options.set_preference(
        "browser.newtabpage.activity-stream.telemetry",
        False,
    )

    options.set_preference(
        "datareporting.healthreport.uploadEnabled",
        False,
    )

    options.set_preference(
        "datareporting.policy.dataSubmissionEnabled",
        False,
    )

    options.set_preference(
        "toolkit.telemetry.enabled",
        False,
    )

    #
    # Do not block application network resources.
    #
    options.set_preference(
        "privacy.trackingprotection.enabled",
        False,
    )

    options.set_preference(
        "privacy.trackingprotection.pbmode.enabled",
        False,
    )

    options.set_preference(
        "network.cookie.cookieBehavior",
        0,
    )

    #
    # Container/headless rendering.
    #
    options.set_preference(
        "gfx.webrender.software",
        True,
    )

    options.set_preference(
        "devtools.console.stdout.content",
        True,
    )

    service = Service(
        executable_path="/usr/local/bin/geckodriver",
        log_output=sys.stdout,
    )

    return webdriver.Firefox(
        service=service,
        options=options,
    )


def main():
    print(
        f"Configured measurement timeout: {TIMEOUT}s",
        flush=True,
    )

    driver = create_driver()

    try:
        driver.set_page_load_timeout(
            60
        )

        driver.set_window_size(
            1440,
            1200,
        )

        print(
            f"Opening {URL}",
            flush=True,
        )

        driver.get(URL)

        #
        # Wait until the page itself has loaded.
        #
        WebDriverWait(
            driver,
            60,
        ).until(
            lambda d: d.execute_script(
                "return document.readyState"
            )
            == "complete"
        )

        print(
            f"Loaded: {driver.current_url}",
            flush=True,
        )

        print(
            f"Page title: {driver.title}",
            flush=True,
        )

        #
        # Install JS error recording for later diagnostics.
        #
        install_error_recorder(driver)

        print(
            "Waiting for application controls...",
            flush=True,
        )

        try:
            WebDriverWait(
                driver,
                120,
                poll_frequency=1,
            ).until(
                application_is_ready
            )

        except TimeoutException:
            dump_diagnostics(driver)

            dump_page_source(
                driver,
                "initialization-error.html",
            )

            save_screenshot(
                driver,
                "initialization-error.png",
            )

            raise TimeoutException(
                "The page loaded, but the "
                "measurement application did not "
                "render its controls."
            )

        print(
            "Application initialized.",
            flush=True,
        )

        #
        # 1. Opt in
        #
        click_opt_in(driver)

        #
        # Give the UI a moment to update.
        #
        time.sleep(1)

        #
        # 2. Start measurement
        #
        click_start_measurement(driver)

        #
        # 3. Wait for completion
        #
        wait_for_measurement(driver)

        #
        # 4. Save final state
        #
        save_screenshot(
            driver,
            "measurement-result.png",
        )

        dump_page_source(
            driver,
            "measurement-result.html",
        )

        print(
            "Done.",
            flush=True,
        )

    except KeyboardInterrupt:
        print(
            "Interrupted by user/container.",
            file=sys.stderr,
            flush=True,
        )

        try:
            save_screenshot(
                driver,
                "measurement-interrupted.png",
            )

            dump_page_source(
                driver,
                "measurement-interrupted.html",
            )
        except Exception:
            pass

        sys.exit(130)

    except Exception as error:
        print(
            f"Measurement failed: "
            f"{type(error).__name__}: "
            f"{error}",
            file=sys.stderr,
            flush=True,
        )

        try:
            save_screenshot(
                driver,
                "measurement-error.png",
            )

            dump_page_source(
                driver,
                "measurement-error.html",
            )

            dump_diagnostics(
                driver
            )
        except Exception:
            pass

        raise

    finally:
        driver.quit()


if __name__ == "__main__":
    main()
